/* eslint-disable */
// Generated from the independent closed CONTENT3 schema.
import ucs2length from 'ajv/dist/runtime/ucs2length.js';
('use strict');
export const teachingManifestSchema = validate10;
const schema11 = {
  $id: 'urn:cviz:content:c6:manifest:3.0.0',
  definitions: {
    ref: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 180,
          pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
        },
        version: {
          type: 'string',
          minLength: 1,
          maxLength: 20,
          pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$',
        },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    locator: {
      type: 'object',
      properties: {
        physicalPage: { type: 'integer', minimum: 1, maximum: 1635 },
        originalPrintPage: { const: null },
      },
      required: ['physicalPage', 'originalPrintPage'],
      additionalProperties: false,
    },
    proof: {
      type: 'object',
      properties: {
        kind: { const: 'rust-verified' },
        engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
      required: ['kind', 'engineBuildSha256', 'sourceSha256', 'requestSha256', 'resultSha256'],
      additionalProperties: false,
    },
    node: {
      type: 'object',
      properties: {
        ref: { $ref: '#/definitions/ref' },
        sourceNodeId: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          pattern: '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
        },
        parentRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
        order: { type: 'integer', minimum: 1, maximum: 650 },
        titleOriginal: { type: 'string', minLength: 1, maxLength: 500 },
        titleDisplay: { type: 'string', minLength: 1, maxLength: 500 },
        category: {
          enum: [
            'directory-container',
            'exercise-group',
            'teaching-lesson',
            'reference-answer-or-bibliography',
          ],
        },
        area: { enum: ['course', 'reference'] },
        locator: { $ref: '#/definitions/locator' },
        objective: { type: 'string', minLength: 1, maxLength: 8192 },
        body: { type: 'string', minLength: 100, maxLength: 65536 },
        lessonRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
        activityRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 900,
          minItems: 0,
        },
        exampleRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 900,
          minItems: 0,
        },
        programRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 900,
          minItems: 0,
        },
        platformSupplement: { const: true },
      },
      required: [
        'ref',
        'sourceNodeId',
        'parentRef',
        'order',
        'titleOriginal',
        'titleDisplay',
        'category',
        'area',
        'locator',
        'objective',
        'body',
        'lessonRef',
        'activityRefs',
        'exampleRefs',
        'programRefs',
        'platformSupplement',
      ],
      additionalProperties: false,
    },
    lesson: {
      type: 'object',
      properties: {
        ref: { $ref: '#/definitions/ref' },
        sourceNodeRef: { $ref: '#/definitions/ref' },
        chapterRef: { $ref: '#/definitions/ref' },
        knowledgeRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 1,
          minItems: 1,
        },
        mandatory: { const: true },
        learningRevision: { const: 1 },
        acceptedPriorVersions: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 20 },
          maxItems: 0,
          minItems: 0,
        },
        requiredActivityRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 1,
          minItems: 0,
        },
        optionalActivityRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 900,
          minItems: 0,
        },
        exampleRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 900,
          minItems: 0,
        },
        programRefs: {
          type: 'array',
          items: { $ref: '#/definitions/ref' },
          maxItems: 10,
          minItems: 1,
        },
        rewardGroupId: {
          type: 'string',
          minLength: 1,
          maxLength: 180,
          pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
        },
        completion: {
          type: 'object',
          properties: {
            reading: { const: 'explicit-confirmation' },
            execution: { const: 'all-bound-judge-groups' },
          },
          required: ['reading', 'execution'],
          additionalProperties: false,
        },
      },
      required: [
        'ref',
        'sourceNodeRef',
        'chapterRef',
        'knowledgeRefs',
        'mandatory',
        'learningRevision',
        'acceptedPriorVersions',
        'requiredActivityRefs',
        'optionalActivityRefs',
        'exampleRefs',
        'programRefs',
        'rewardGroupId',
        'completion',
      ],
      additionalProperties: false,
    },
    activity: {
      oneOf: [
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            sourceNodeRef: { $ref: '#/definitions/ref' },
            lessonRef: { $ref: '#/definitions/ref' },
            learningRevision: { const: 1 },
            goal: { type: 'string', minLength: 1, maxLength: 8192 },
            knowledgeRef: { $ref: '#/definitions/ref' },
            platformSupplement: { const: true },
            originalExercisePassClaim: { const: false },
            kind: { const: 'source-design-guide' },
            mandatory: { const: false },
            sourceQuestion: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 100,
                  pattern: '^c6\\.s[0-9]+\\.[0-9]+\\.q[0-9]{2}$',
                },
                kind: { enum: ['review', 'programming'] },
                locator: { $ref: '#/definitions/locator' },
              },
              required: ['id', 'kind', 'locator'],
              additionalProperties: false,
            },
            discussion: { type: 'string', minLength: 1, maxLength: 20000 },
            codingAssessment: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    scope: { type: 'string', minLength: 1, maxLength: 8192 },
                    design: { type: 'string', minLength: 1, maxLength: 8192 },
                    boundaries: {
                      type: 'array',
                      items: { type: 'string', minLength: 1, maxLength: 8192 },
                      maxItems: 30,
                      minItems: 1,
                    },
                    originalExercisePassClaim: { const: false },
                  },
                  required: ['scope', 'design', 'boundaries', 'originalExercisePassClaim'],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
          },
          required: [
            'ref',
            'sourceNodeRef',
            'lessonRef',
            'learningRevision',
            'goal',
            'knowledgeRef',
            'platformSupplement',
            'originalExercisePassClaim',
            'kind',
            'mandatory',
            'sourceQuestion',
            'discussion',
            'codingAssessment',
          ],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            sourceNodeRef: { $ref: '#/definitions/ref' },
            lessonRef: { $ref: '#/definitions/ref' },
            learningRevision: { const: 1 },
            goal: { type: 'string', minLength: 1, maxLength: 8192 },
            knowledgeRef: { $ref: '#/definitions/ref' },
            platformSupplement: { const: true },
            originalExercisePassClaim: { const: false },
            kind: { const: 'rust-execution' },
            mandatory: { const: true },
            exerciseRef: { $ref: '#/definitions/ref' },
            judgeProfileRef: { $ref: '#/definitions/ref' },
          },
          required: [
            'ref',
            'sourceNodeRef',
            'lessonRef',
            'learningRevision',
            'goal',
            'knowledgeRef',
            'platformSupplement',
            'originalExercisePassClaim',
            'kind',
            'mandatory',
            'exerciseRef',
            'judgeProfileRef',
          ],
          additionalProperties: false,
        },
      ],
    },
    example: {
      oneOf: [
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            sourceExampleId: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              pattern: '^c6\\.listing[0-9]+\\.[0-9]+$',
            },
            sourceNodeRef: { $ref: '#/definitions/ref' },
            lessonRef: { $ref: '#/definitions/ref' },
            titleOriginal: { type: 'string', minLength: 1, maxLength: 500 },
            locator: { $ref: '#/definitions/locator' },
            source: { type: 'string', minLength: 1, maxLength: 32768 },
            input: { type: 'string', minLength: 0, maxLength: 32768 },
            expectedStdout: {
              anyOf: [{ type: 'string', minLength: 0, maxLength: 32768 }, { type: 'null' }],
            },
            expectedReturn: {
              anyOf: [
                { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
                { type: 'null' },
              ],
            },
            explanation: { type: 'string', minLength: 1, maxLength: 16000 },
            reviewFocus: { type: 'string', minLength: 1, maxLength: 16000 },
            platformSupplement: { const: true },
            mode: { const: 'c6-independent-executable' },
            verification: { $ref: '#/definitions/proof' },
          },
          required: [
            'ref',
            'sourceExampleId',
            'sourceNodeRef',
            'lessonRef',
            'titleOriginal',
            'locator',
            'source',
            'input',
            'expectedStdout',
            'expectedReturn',
            'explanation',
            'reviewFocus',
            'platformSupplement',
            'mode',
            'verification',
          ],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            sourceExampleId: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              pattern: '^c6\\.listing[0-9]+\\.[0-9]+$',
            },
            sourceNodeRef: { $ref: '#/definitions/ref' },
            lessonRef: { $ref: '#/definitions/ref' },
            titleOriginal: { type: 'string', minLength: 1, maxLength: 500 },
            locator: { $ref: '#/definitions/locator' },
            source: { type: 'string', minLength: 1, maxLength: 32768 },
            input: { type: 'string', minLength: 0, maxLength: 32768 },
            expectedStdout: {
              anyOf: [{ type: 'string', minLength: 0, maxLength: 32768 }, { type: 'null' }],
            },
            expectedReturn: {
              anyOf: [
                { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
                { type: 'null' },
              ],
            },
            explanation: { type: 'string', minLength: 1, maxLength: 16000 },
            reviewFocus: { type: 'string', minLength: 1, maxLength: 16000 },
            platformSupplement: { const: true },
            mode: { const: 'c6-diagnostic-demo' },
            verification: { $ref: '#/definitions/proof' },
            expectedDiagnostic: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    kind: { const: 'rust-diagnostic' },
                    code: {
                      enum: [
                        'E_PARSE_INVALID',
                        'E_ARGUMENTS',
                        'E_UNINITIALIZED',
                        'E_POINTER_BOUNDS',
                      ],
                    },
                    anchor: { type: 'string', minLength: 1, maxLength: 1000 },
                  },
                  required: ['kind', 'code', 'anchor'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    kind: { const: 'semantic-output-mismatch' },
                    businessExpectedStdout: { type: 'string', minLength: 0, maxLength: 32768 },
                    anchor: { type: 'string', minLength: 1, maxLength: 1000 },
                    correctedExpression: { type: 'string', minLength: 1, maxLength: 1000 },
                  },
                  required: ['kind', 'businessExpectedStdout', 'anchor', 'correctedExpression'],
                  additionalProperties: false,
                },
              ],
            },
          },
          required: [
            'ref',
            'sourceExampleId',
            'sourceNodeRef',
            'lessonRef',
            'titleOriginal',
            'locator',
            'source',
            'input',
            'expectedStdout',
            'expectedReturn',
            'explanation',
            'reviewFocus',
            'platformSupplement',
            'mode',
            'verification',
            'expectedDiagnostic',
          ],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            sourceExampleId: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              pattern: '^c6\\.listing[0-9]+\\.[0-9]+$',
            },
            sourceNodeRef: { $ref: '#/definitions/ref' },
            lessonRef: { $ref: '#/definitions/ref' },
            titleOriginal: { type: 'string', minLength: 1, maxLength: 500 },
            locator: { $ref: '#/definitions/locator' },
            source: { type: 'string', minLength: 1, maxLength: 32768 },
            input: { type: 'string', minLength: 0, maxLength: 32768 },
            expectedStdout: {
              anyOf: [{ type: 'string', minLength: 0, maxLength: 32768 }, { type: 'null' }],
            },
            expectedReturn: {
              anyOf: [
                { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
                { type: 'null' },
              ],
            },
            explanation: { type: 'string', minLength: 1, maxLength: 16000 },
            reviewFocus: { type: 'string', minLength: 1, maxLength: 16000 },
            platformSupplement: { const: true },
            mode: { const: 'reading-only' },
            reason: { type: 'string', minLength: 1, maxLength: 16000 },
            readingBoundary: { type: 'string', minLength: 1, maxLength: 16000 },
            verification: {
              type: 'object',
              properties: { kind: { const: 'reading-not-executed' } },
              required: ['kind'],
              additionalProperties: false,
            },
            sourceFileName: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              pattern: '^[a-z][a-z0-9_-]*\\.c$',
            },
            companionFiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 80,
                    pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$',
                  },
                  source: { type: 'string', minLength: 1, maxLength: 32768 },
                },
                required: ['path', 'source'],
                additionalProperties: false,
              },
              minItems: 1,
              maxItems: 3,
            },
          },
          required: [
            'ref',
            'sourceExampleId',
            'sourceNodeRef',
            'lessonRef',
            'titleOriginal',
            'locator',
            'source',
            'input',
            'expectedStdout',
            'expectedReturn',
            'explanation',
            'reviewFocus',
            'platformSupplement',
            'mode',
            'reason',
            'readingBoundary',
            'verification',
          ],
          additionalProperties: false,
        },
      ],
    },
    exercise: {
      type: 'object',
      properties: {
        ref: { $ref: '#/definitions/ref' },
        sourceNodeRef: { $ref: '#/definitions/ref' },
        lessonRef: { $ref: '#/definitions/ref' },
        profileRef: { $ref: '#/definitions/ref' },
        programRef: { $ref: '#/definitions/ref' },
        learningRevision: { const: 1 },
        acceptedPriorVersions: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 20 },
          minItems: 0,
          maxItems: 0,
        },
        platformSupplement: { const: true },
        semanticTargets: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 150 },
          minItems: 1,
          maxItems: 10,
        },
        nodeSpecificRequirement: { type: 'string', minLength: 1, maxLength: 8192 },
        tests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              caseKey: { enum: ['case-1', 'case-2', 'case-3', 'case-4'] },
              stdin: { type: 'string', minLength: 0, maxLength: 256 },
              expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
              expectedReturnCode: { const: 0 },
              purpose: { type: 'string', minLength: 1, maxLength: 8192 },
              observationRule: { type: 'string', minLength: 1, maxLength: 8192 },
            },
            required: [
              'caseKey',
              'stdin',
              'expectedStdout',
              'expectedReturnCode',
              'purpose',
              'observationRule',
            ],
            additionalProperties: false,
          },
          minItems: 4,
          maxItems: 4,
        },
        verification: {
          type: 'object',
          properties: {
            referenceStatus: { const: 'passed' },
            starterStatus: { const: 'failed' },
            caseCount: { const: 4 },
            reference: { $ref: '#/definitions/proof' },
            starter: { $ref: '#/definitions/proof' },
          },
          required: ['referenceStatus', 'starterStatus', 'caseCount', 'reference', 'starter'],
          additionalProperties: false,
        },
        title: { type: 'string', minLength: 1, maxLength: 8192 },
        prompt: { type: 'string', minLength: 1, maxLength: 16000 },
        inputContract: { type: 'string', minLength: 1, maxLength: 8192 },
        outputContract: { type: 'string', minLength: 1, maxLength: 8192 },
        starterSource: { type: 'string', minLength: 1, maxLength: 32768 },
        referenceSource: { type: 'string', minLength: 1, maxLength: 32768 },
        hints: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 8192 },
          minItems: 3,
          maxItems: 3,
        },
        commonMistakes: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 8192 },
          minItems: 1,
          maxItems: 30,
        },
        boundaryExplanation: { type: 'string', minLength: 1, maxLength: 16000 },
        reviewFocus: { type: 'string', minLength: 1, maxLength: 16000 },
      },
      required: [
        'ref',
        'sourceNodeRef',
        'lessonRef',
        'profileRef',
        'programRef',
        'learningRevision',
        'acceptedPriorVersions',
        'platformSupplement',
        'semanticTargets',
        'nodeSpecificRequirement',
        'tests',
        'verification',
        'title',
        'prompt',
        'inputContract',
        'outputContract',
        'starterSource',
        'referenceSource',
        'hints',
        'commonMistakes',
        'boundaryExplanation',
        'reviewFocus',
      ],
      additionalProperties: false,
    },
    knowledge: {
      type: 'object',
      properties: {
        ref: { $ref: '#/definitions/ref' },
        sourceNodeRef: { $ref: '#/definitions/ref' },
        kind: { enum: ['chapter', 'lesson'] },
        title: { type: 'string', minLength: 1, maxLength: 500 },
        chapterKnowledgeRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
        precision: { enum: ['lesson', 'chapter-only-source-design'] },
      },
      required: ['ref', 'sourceNodeRef', 'kind', 'title', 'chapterKnowledgeRef', 'precision'],
      additionalProperties: false,
    },
    compatibility: {
      anyOf: [
        {
          type: 'object',
          properties: {
            legacyMapSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            rewardMappingSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            legacyLinks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { enum: ['lesson', 'exercise', 'case', 'supplemental-exercise'] },
                  fromRef: { $ref: '#/definitions/ref' },
                  targetRef: { $ref: '#/definitions/ref' },
                  relatedSourceNodeRef: {
                    anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }],
                  },
                  oldPackageRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
                  language: { anyOf: [{ enum: ['c', 'cpp'] }, { type: 'null' }] },
                  learningRevision: {
                    anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }],
                  },
                  acceptedPriorVersions: {
                    type: 'array',
                    items: { type: 'string', minLength: 1, maxLength: 20 },
                    minItems: 0,
                    maxItems: 20,
                  },
                  transferPass: { const: false },
                },
                required: [
                  'kind',
                  'fromRef',
                  'targetRef',
                  'relatedSourceNodeRef',
                  'oldPackageRef',
                  'language',
                  'learningRevision',
                  'acceptedPriorVersions',
                  'transferPass',
                ],
                additionalProperties: false,
              },
              minItems: 79,
              maxItems: 79,
            },
            rewardGroups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 180,
                    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                  },
                  lessonRefs: {
                    type: 'array',
                    items: { $ref: '#/definitions/ref' },
                    minItems: 0,
                    maxItems: 900,
                  },
                  exerciseRefs: {
                    type: 'array',
                    items: { $ref: '#/definitions/ref' },
                    minItems: 0,
                    maxItems: 900,
                  },
                  legacyLessonRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
                  legacyExerciseRef: { anyOf: [{ $ref: '#/definitions/ref' }, { type: 'null' }] },
                  lessonReward: {
                    type: 'object',
                    properties: {
                      points: { const: 20 },
                      subjectId: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 180,
                        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                      },
                      sourceId: { const: 'reward.lesson.first-completion' },
                    },
                    required: ['points', 'subjectId', 'sourceId'],
                    additionalProperties: false,
                  },
                  exerciseReward: {
                    type: 'object',
                    properties: {
                      points: { const: 10 },
                      subjectId: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 180,
                        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                      },
                      sourceId: { const: 'reward.exercise.first-pass' },
                    },
                    required: ['points', 'subjectId', 'sourceId'],
                    additionalProperties: false,
                  },
                  emptyNewGroupCanGrant: { const: false },
                },
                required: [
                  'id',
                  'lessonRefs',
                  'exerciseRefs',
                  'legacyLessonRef',
                  'legacyExerciseRef',
                  'lessonReward',
                  'exerciseReward',
                  'emptyNewGroupCanGrant',
                ],
                additionalProperties: false,
              },
              minItems: 42,
              maxItems: 42,
            },
          },
          required: ['legacyMapSha256', 'rewardMappingSha256', 'legacyLinks', 'rewardGroups'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    program: {
      oneOf: [
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 80,
                    pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$',
                  },
                  source: { type: 'string', minLength: 1, maxLength: 32768 },
                },
                required: ['name', 'source'],
                additionalProperties: false,
              },
              maxItems: 4,
              minItems: 1,
            },
            mode: { const: 'reading' },
            boundary: { type: 'string', minLength: 1, maxLength: 16000 },
            prediction: { type: 'string', minLength: 1, maxLength: 20000 },
            verification: {
              type: 'object',
              properties: { kind: { const: 'reading-not-executed' } },
              required: ['kind'],
              additionalProperties: false,
            },
          },
          required: ['ref', 'title', 'files', 'mode', 'boundary', 'prediction', 'verification'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 80,
                    pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$',
                  },
                  source: { type: 'string', minLength: 1, maxLength: 32768 },
                },
                required: ['name', 'source'],
                additionalProperties: false,
              },
              maxItems: 4,
              minItems: 1,
            },
            mode: { const: 'execute' },
            input: { type: 'string', minLength: 0, maxLength: 256 },
            expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
            expectedReturn: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
            verification: {
              type: 'object',
              properties: {
                kind: { const: 'rust-verified' },
                engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              },
              required: [
                'kind',
                'engineBuildSha256',
                'sourceSha256',
                'bundleSha256',
                'inputSha256',
                'requestSha256',
                'resultSha256',
              ],
              additionalProperties: false,
            },
            additionalRuns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  input: { type: 'string', minLength: 0, maxLength: 256 },
                  expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
                  expectedReturn: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
                  verification: {
                    type: 'object',
                    properties: {
                      kind: { const: 'rust-verified' },
                      engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    },
                    required: [
                      'kind',
                      'engineBuildSha256',
                      'sourceSha256',
                      'bundleSha256',
                      'inputSha256',
                      'requestSha256',
                      'resultSha256',
                    ],
                    additionalProperties: false,
                  },
                },
                required: ['input', 'expectedStdout', 'expectedReturn', 'verification'],
                additionalProperties: false,
              },
              maxItems: 30,
              minItems: 0,
            },
          },
          required: [
            'ref',
            'title',
            'files',
            'mode',
            'input',
            'expectedStdout',
            'expectedReturn',
            'verification',
            'additionalRuns',
          ],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 80,
                    pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$',
                  },
                  source: { type: 'string', minLength: 1, maxLength: 32768 },
                },
                required: ['name', 'source'],
                additionalProperties: false,
              },
              maxItems: 4,
              minItems: 1,
            },
            mode: { const: 'diagnostic' },
            input: { type: 'string', minLength: 0, maxLength: 256 },
            expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
            expectedReturn: { const: null },
            verification: {
              type: 'object',
              properties: {
                kind: { const: 'rust-verified' },
                engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              },
              required: [
                'kind',
                'engineBuildSha256',
                'sourceSha256',
                'bundleSha256',
                'inputSha256',
                'requestSha256',
                'resultSha256',
              ],
              additionalProperties: false,
            },
            expectedCode: {
              enum: [
                'E_STRUCT_LIMIT',
                'E_FIELD_LIMIT',
                'E_NULL_POINTER',
                'E_DANGLING_POINTER',
                'E_POINTER_BOUNDS',
                'E_OBJECT_LIMIT',
                'E_PROTOCOL_INVALID',
                'E_UNSUPPORTED_VERSION',
                'E_SOURCE_LIMIT',
                'E_REQUEST_LIMIT',
                'E_INPUT_INVALID',
                'E_LEX_INVALID',
                'E_PARSE_INVALID',
                'E_NAME_INVALID',
                'E_UNSUPPORTED_SYNTAX',
                'E_DEPTH_LIMIT',
                'E_FUNCTION_LIMIT',
                'E_PARAMETER_LIMIT',
                'E_DUPLICATE',
                'E_UNDECLARED',
                'E_TYPE_INVALID',
                'E_ARGUMENTS',
                'E_RETURN_MISSING',
                'E_STACK_LIMIT',
                'E_UNINITIALIZED',
                'E_BOUNDS',
                'E_DIV_ZERO',
                'E_OVERFLOW',
                'E_INPUT_EXHAUSTED',
                'E_OUTPUT_LIMIT',
                'E_MEMORY_LIMIT',
                'E_STEP_LIMIT',
                'E_RESULT_LIMIT',
                'E_FUEL_LIMIT',
                'E_DEADLINE',
                'E_CANCELLED',
                'E_ENCODING_FAILURE',
                'E_INPUT_KIND',
                'E_STRING_BOUNDS',
                'E_CHAR_DOMAIN',
                'E_FLOAT_NONFINITE',
                'E_SHIFT_INVALID',
                'E_FORMAT_UNSUPPORTED',
                'E_STRING_UNTERMINATED',
                'E_READONLY',
                'E_CONST_WRITE',
                'E_MACRO_UNSUPPORTED',
              ],
            },
            diagnosticExplanation: { type: 'string', minLength: 1, maxLength: 16000 },
            additionalRuns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  input: { type: 'string', minLength: 0, maxLength: 256 },
                  expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
                  expectedReturn: { const: null },
                  verification: {
                    type: 'object',
                    properties: {
                      kind: { const: 'rust-verified' },
                      engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    },
                    required: [
                      'kind',
                      'engineBuildSha256',
                      'sourceSha256',
                      'bundleSha256',
                      'inputSha256',
                      'requestSha256',
                      'resultSha256',
                    ],
                    additionalProperties: false,
                  },
                  expectedCode: {
                    enum: [
                      'E_STRUCT_LIMIT',
                      'E_FIELD_LIMIT',
                      'E_NULL_POINTER',
                      'E_DANGLING_POINTER',
                      'E_POINTER_BOUNDS',
                      'E_OBJECT_LIMIT',
                      'E_PROTOCOL_INVALID',
                      'E_UNSUPPORTED_VERSION',
                      'E_SOURCE_LIMIT',
                      'E_REQUEST_LIMIT',
                      'E_INPUT_INVALID',
                      'E_LEX_INVALID',
                      'E_PARSE_INVALID',
                      'E_NAME_INVALID',
                      'E_UNSUPPORTED_SYNTAX',
                      'E_DEPTH_LIMIT',
                      'E_FUNCTION_LIMIT',
                      'E_PARAMETER_LIMIT',
                      'E_DUPLICATE',
                      'E_UNDECLARED',
                      'E_TYPE_INVALID',
                      'E_ARGUMENTS',
                      'E_RETURN_MISSING',
                      'E_STACK_LIMIT',
                      'E_UNINITIALIZED',
                      'E_BOUNDS',
                      'E_DIV_ZERO',
                      'E_OVERFLOW',
                      'E_INPUT_EXHAUSTED',
                      'E_OUTPUT_LIMIT',
                      'E_MEMORY_LIMIT',
                      'E_STEP_LIMIT',
                      'E_RESULT_LIMIT',
                      'E_FUEL_LIMIT',
                      'E_DEADLINE',
                      'E_CANCELLED',
                      'E_ENCODING_FAILURE',
                      'E_INPUT_KIND',
                      'E_STRING_BOUNDS',
                      'E_CHAR_DOMAIN',
                      'E_FLOAT_NONFINITE',
                      'E_SHIFT_INVALID',
                      'E_FORMAT_UNSUPPORTED',
                      'E_STRING_UNTERMINATED',
                      'E_READONLY',
                      'E_CONST_WRITE',
                      'E_MACRO_UNSUPPORTED',
                    ],
                  },
                },
                required: [
                  'input',
                  'expectedStdout',
                  'expectedReturn',
                  'verification',
                  'expectedCode',
                ],
                additionalProperties: false,
              },
              maxItems: 30,
              minItems: 0,
            },
          },
          required: [
            'ref',
            'title',
            'files',
            'mode',
            'input',
            'expectedStdout',
            'expectedReturn',
            'verification',
            'expectedCode',
            'diagnosticExplanation',
            'additionalRuns',
          ],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            ref: { $ref: '#/definitions/ref' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 80,
                    pattern: '^[a-z][a-z0-9_-]*\\.(?:c|h)$',
                  },
                  source: { type: 'string', minLength: 1, maxLength: 32768 },
                },
                required: ['name', 'source'],
                additionalProperties: false,
              },
              maxItems: 4,
              minItems: 1,
            },
            mode: { const: 'diagnostic' },
            input: { type: 'string', minLength: 0, maxLength: 256 },
            expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
            expectedReturn: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
            verification: {
              type: 'object',
              properties: {
                kind: { const: 'rust-verified' },
                engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              },
              required: [
                'kind',
                'engineBuildSha256',
                'sourceSha256',
                'bundleSha256',
                'inputSha256',
                'requestSha256',
                'resultSha256',
              ],
              additionalProperties: false,
            },
            expectedCode: { const: null },
            businessExpectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
            diagnosticExplanation: { type: 'string', minLength: 1, maxLength: 16000 },
            additionalRuns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  input: { type: 'string', minLength: 0, maxLength: 256 },
                  expectedStdout: { type: 'string', minLength: 0, maxLength: 16384 },
                  expectedReturn: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
                  verification: {
                    type: 'object',
                    properties: {
                      kind: { const: 'rust-verified' },
                      engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      bundleSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      inputSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      requestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      resultSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    },
                    required: [
                      'kind',
                      'engineBuildSha256',
                      'sourceSha256',
                      'bundleSha256',
                      'inputSha256',
                      'requestSha256',
                      'resultSha256',
                    ],
                    additionalProperties: false,
                  },
                },
                required: ['input', 'expectedStdout', 'expectedReturn', 'verification'],
                additionalProperties: false,
              },
              maxItems: 0,
              minItems: 0,
            },
          },
          required: [
            'ref',
            'title',
            'files',
            'mode',
            'input',
            'expectedStdout',
            'expectedReturn',
            'verification',
            'expectedCode',
            'businessExpectedStdout',
            'diagnosticExplanation',
            'additionalRuns',
          ],
          additionalProperties: false,
        },
      ],
    },
  },
  type: 'object',
  properties: {
    contractVersion: { const: '3.0.0' },
    packageRef: {
      type: 'object',
      properties: { id: { const: 'content.c.primer6' }, version: { const: '2.0.0' } },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    languageRef: {
      type: 'object',
      properties: { id: { const: 'lang.c' }, version: { const: '1.0.0' } },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    engineRef: {
      type: 'object',
      properties: { id: { const: 'engine.rust.c6' }, version: { const: '0.1.0' } },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    engineBuildSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    judgeOwnerPackageRef: {
      type: 'object',
      properties: { id: { const: 'content.c.primer6' }, version: { const: '1.0.0' } },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    judgeContractVersion: { const: '2.0.0' },
    scopeRevision: { const: 'user-20261102-full-key-teaching' },
    source: {
      type: 'object',
      properties: {
        id: { const: 'source.c.primer6' },
        edition: { const: 6 },
        sha256: { const: 'c23d60af4adb9a6d90a91c0709ae3b94ef32063cfcbe1792d97e99792afd14e6' },
      },
      required: ['id', 'edition', 'sha256'],
      additionalProperties: false,
    },
    sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    counts: {
      type: 'object',
      properties: {
        nodes: { const: 650 },
        lessons: { const: 404 },
        teachingBodies: { const: 505 },
        teachingProgramSlots: { const: 576 },
        teachingPrograms: { const: 386 },
        concepts: { const: 0 },
        requiredLessons: { const: 404 },
        directoryContainers: { const: 112 },
        exerciseGroupContainers: { const: 34 },
        referenceNodes: { const: 111 },
        activities: { const: 389 },
        requiredActivities: { const: 44 },
        optionalActivities: { const: 345 },
        sourceReviewGuides: { const: 177 },
        sourceProgrammingGuides: { const: 168 },
        executionExercises: { const: 44 },
        judgeGroups: { const: 176 },
        examples: { const: 232 },
        executableExamples: { const: 124 },
        diagnosticExamples: { const: 7 },
        readingExamples: { const: 101 },
        knowledgeNodes: { const: 421 },
        lazyChunks: { const: 19 },
      },
      required: [
        'nodes',
        'lessons',
        'teachingBodies',
        'teachingProgramSlots',
        'teachingPrograms',
        'concepts',
        'requiredLessons',
        'directoryContainers',
        'exerciseGroupContainers',
        'referenceNodes',
        'activities',
        'requiredActivities',
        'optionalActivities',
        'sourceReviewGuides',
        'sourceProgrammingGuides',
        'executionExercises',
        'judgeGroups',
        'examples',
        'executableExamples',
        'diagnosticExamples',
        'readingExamples',
        'knowledgeNodes',
        'lazyChunks',
      ],
      additionalProperties: false,
    },
    budgets: {
      type: 'object',
      properties: {
        packageBytes: { const: 20971520 },
        manifestBytes: { const: 262144 },
        chunkBytes: { const: 1048576 },
        sourceBytes: { const: 32768 },
      },
      required: ['packageBytes', 'manifestBytes', 'chunkBytes', 'sourceBytes'],
      additionalProperties: false,
    },
    compatibilityChunkId: { const: 'chA' },
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            enum: [
              'ch01',
              'ch02',
              'ch03',
              'ch04',
              'ch05',
              'ch06',
              'ch07',
              'ch08',
              'ch09',
              'ch10',
              'ch11',
              'ch12',
              'ch13',
              'ch14',
              'ch15',
              'ch16',
              'ch17',
              'chA',
              'chB',
            ],
          },
          kind: { enum: ['course-chapter', 'reference-appendix'] },
          rootNodeId: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
          },
          file: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^ch(?:[0-9]{2}|[AB])-2\\.0\\.0\\.json$',
          },
          bytes: { type: 'integer', minimum: 1, maximum: 1048576 },
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          counts: {
            type: 'object',
            properties: {
              nodes: { type: 'integer', minimum: 0, maximum: 900 },
              lessons: { type: 'integer', minimum: 0, maximum: 900 },
              activities: { type: 'integer', minimum: 0, maximum: 900 },
              examples: { type: 'integer', minimum: 0, maximum: 900 },
              exercises: { type: 'integer', minimum: 0, maximum: 900 },
              knowledge: { type: 'integer', minimum: 0, maximum: 900 },
              programs: { type: 'integer', minimum: 0, maximum: 900 },
            },
            required: [
              'nodes',
              'lessons',
              'activities',
              'examples',
              'exercises',
              'knowledge',
              'programs',
            ],
            additionalProperties: false,
          },
          entityIds: {
            type: 'object',
            properties: {
              lessons: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
              activities: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
              examples: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
              exercises: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
              knowledge: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
              programs: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 180,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                },
                maxItems: 900,
                minItems: 0,
              },
            },
            required: ['lessons', 'activities', 'examples', 'exercises', 'knowledge', 'programs'],
            additionalProperties: false,
          },
        },
        required: ['id', 'kind', 'rootNodeId', 'file', 'bytes', 'sha256', 'counts', 'entityIds'],
        additionalProperties: false,
      },
      maxItems: 19,
      minItems: 19,
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
          },
          parentId: {
            anyOf: [
              {
                type: 'string',
                minLength: 1,
                maxLength: 80,
                pattern: '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
              },
              { type: 'null' },
            ],
          },
          order: { type: 'integer', minimum: 1, maximum: 650 },
          titleOriginal: { type: 'string', minLength: 1, maxLength: 500 },
          titleDisplay: { type: 'string', minLength: 1, maxLength: 500 },
          category: {
            enum: [
              'directory-container',
              'exercise-group',
              'teaching-lesson',
              'reference-answer-or-bibliography',
            ],
          },
          physicalPage: { type: 'integer', minimum: 1, maximum: 1635 },
          chunkId: {
            enum: [
              'ch01',
              'ch02',
              'ch03',
              'ch04',
              'ch05',
              'ch06',
              'ch07',
              'ch08',
              'ch09',
              'ch10',
              'ch11',
              'ch12',
              'ch13',
              'ch14',
              'ch15',
              'ch16',
              'ch17',
              'chA',
              'chB',
            ],
          },
        },
        required: [
          'id',
          'parentId',
          'order',
          'titleOriginal',
          'titleDisplay',
          'category',
          'physicalPage',
          'chunkId',
        ],
        additionalProperties: false,
      },
      maxItems: 650,
      minItems: 650,
    },
  },
  required: [
    'contractVersion',
    'packageRef',
    'languageRef',
    'engineRef',
    'engineBuildSha256',
    'judgeOwnerPackageRef',
    'judgeContractVersion',
    'scopeRevision',
    'source',
    'sourceSha256',
    'counts',
    'budgets',
    'compatibilityChunkId',
    'chunks',
    'nodes',
  ],
  additionalProperties: false,
};
const func0 = Object.prototype.hasOwnProperty;
const func163 = ucs2length.default ?? ucs2length;
const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
const pattern2 = new RegExp('^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$', 'u');
const pattern3 = new RegExp('^ch(?:[0-9]{2}|[AB])-2\\.0\\.0\\.json$', 'u');
const pattern5 = new RegExp('^[A-Za-z0-9][A-Za-z0-9._-]*$', 'u');
function validate10(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
) {
  /*# sourceURL="urn:cviz:content:c6:manifest:3.0.0" */ let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        ((data.contractVersion === undefined || !func0.call(data, 'contractVersion')) &&
          (missing0 = 'contractVersion')) ||
        ((data.packageRef === undefined || !func0.call(data, 'packageRef')) &&
          (missing0 = 'packageRef')) ||
        ((data.languageRef === undefined || !func0.call(data, 'languageRef')) &&
          (missing0 = 'languageRef')) ||
        ((data.engineRef === undefined || !func0.call(data, 'engineRef')) &&
          (missing0 = 'engineRef')) ||
        ((data.engineBuildSha256 === undefined || !func0.call(data, 'engineBuildSha256')) &&
          (missing0 = 'engineBuildSha256')) ||
        ((data.judgeOwnerPackageRef === undefined || !func0.call(data, 'judgeOwnerPackageRef')) &&
          (missing0 = 'judgeOwnerPackageRef')) ||
        ((data.judgeContractVersion === undefined || !func0.call(data, 'judgeContractVersion')) &&
          (missing0 = 'judgeContractVersion')) ||
        ((data.scopeRevision === undefined || !func0.call(data, 'scopeRevision')) &&
          (missing0 = 'scopeRevision')) ||
        ((data.source === undefined || !func0.call(data, 'source')) && (missing0 = 'source')) ||
        ((data.sourceSha256 === undefined || !func0.call(data, 'sourceSha256')) &&
          (missing0 = 'sourceSha256')) ||
        ((data.counts === undefined || !func0.call(data, 'counts')) && (missing0 = 'counts')) ||
        ((data.budgets === undefined || !func0.call(data, 'budgets')) && (missing0 = 'budgets')) ||
        ((data.compatibilityChunkId === undefined || !func0.call(data, 'compatibilityChunkId')) &&
          (missing0 = 'compatibilityChunkId')) ||
        ((data.chunks === undefined || !func0.call(data, 'chunks')) && (missing0 = 'chunks')) ||
        ((data.nodes === undefined || !func0.call(data, 'nodes')) && (missing0 = 'nodes'))
      ) {
        validate10.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 of Object.keys(data)) {
          if (!func0.call(schema11.properties, key0)) {
            validate10.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.contractVersion !== undefined && func0.call(data, 'contractVersion')) {
            const _errs2 = errors;
            if ('3.0.0' !== data.contractVersion) {
              validate10.errors = [
                {
                  instancePath: instancePath + '/contractVersion',
                  schemaPath: '#/properties/contractVersion/const',
                  keyword: 'const',
                  params: { allowedValue: '3.0.0' },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.packageRef !== undefined && func0.call(data, 'packageRef')) {
              let data1 = data.packageRef;
              const _errs3 = errors;
              if (errors === _errs3) {
                if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
                  let missing1;
                  if (
                    ((data1.id === undefined || !func0.call(data1, 'id')) && (missing1 = 'id')) ||
                    ((data1.version === undefined || !func0.call(data1, 'version')) &&
                      (missing1 = 'version'))
                  ) {
                    validate10.errors = [
                      {
                        instancePath: instancePath + '/packageRef',
                        schemaPath: '#/properties/packageRef/required',
                        keyword: 'required',
                        params: { missingProperty: missing1 },
                        message: "must have required property '" + missing1 + "'",
                      },
                    ];
                    return false;
                  } else {
                    const _errs5 = errors;
                    for (const key1 of Object.keys(data1)) {
                      if (!(key1 === 'id' || key1 === 'version')) {
                        validate10.errors = [
                          {
                            instancePath: instancePath + '/packageRef',
                            schemaPath: '#/properties/packageRef/additionalProperties',
                            keyword: 'additionalProperties',
                            params: { additionalProperty: key1 },
                            message: 'must NOT have additional properties',
                          },
                        ];
                        return false;
                        break;
                      }
                    }
                    if (_errs5 === errors) {
                      if (data1.id !== undefined && func0.call(data1, 'id')) {
                        const _errs6 = errors;
                        if ('content.c.primer6' !== data1.id) {
                          validate10.errors = [
                            {
                              instancePath: instancePath + '/packageRef/id',
                              schemaPath: '#/properties/packageRef/properties/id/const',
                              keyword: 'const',
                              params: { allowedValue: 'content.c.primer6' },
                              message: 'must be equal to constant',
                            },
                          ];
                          return false;
                        }
                        var valid1 = _errs6 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data1.version !== undefined && func0.call(data1, 'version')) {
                          const _errs7 = errors;
                          if ('2.0.0' !== data1.version) {
                            validate10.errors = [
                              {
                                instancePath: instancePath + '/packageRef/version',
                                schemaPath: '#/properties/packageRef/properties/version/const',
                                keyword: 'const',
                                params: { allowedValue: '2.0.0' },
                                message: 'must be equal to constant',
                              },
                            ];
                            return false;
                          }
                          var valid1 = _errs7 === errors;
                        } else {
                          var valid1 = true;
                        }
                      }
                    }
                  }
                } else {
                  validate10.errors = [
                    {
                      instancePath: instancePath + '/packageRef',
                      schemaPath: '#/properties/packageRef/type',
                      keyword: 'type',
                      params: { type: 'object' },
                      message: 'must be object',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.languageRef !== undefined && func0.call(data, 'languageRef')) {
                let data4 = data.languageRef;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
                    let missing2;
                    if (
                      ((data4.id === undefined || !func0.call(data4, 'id')) && (missing2 = 'id')) ||
                      ((data4.version === undefined || !func0.call(data4, 'version')) &&
                        (missing2 = 'version'))
                    ) {
                      validate10.errors = [
                        {
                          instancePath: instancePath + '/languageRef',
                          schemaPath: '#/properties/languageRef/required',
                          keyword: 'required',
                          params: { missingProperty: missing2 },
                          message: "must have required property '" + missing2 + "'",
                        },
                      ];
                      return false;
                    } else {
                      const _errs10 = errors;
                      for (const key2 of Object.keys(data4)) {
                        if (!(key2 === 'id' || key2 === 'version')) {
                          validate10.errors = [
                            {
                              instancePath: instancePath + '/languageRef',
                              schemaPath: '#/properties/languageRef/additionalProperties',
                              keyword: 'additionalProperties',
                              params: { additionalProperty: key2 },
                              message: 'must NOT have additional properties',
                            },
                          ];
                          return false;
                          break;
                        }
                      }
                      if (_errs10 === errors) {
                        if (data4.id !== undefined && func0.call(data4, 'id')) {
                          const _errs11 = errors;
                          if ('lang.c' !== data4.id) {
                            validate10.errors = [
                              {
                                instancePath: instancePath + '/languageRef/id',
                                schemaPath: '#/properties/languageRef/properties/id/const',
                                keyword: 'const',
                                params: { allowedValue: 'lang.c' },
                                message: 'must be equal to constant',
                              },
                            ];
                            return false;
                          }
                          var valid2 = _errs11 === errors;
                        } else {
                          var valid2 = true;
                        }
                        if (valid2) {
                          if (data4.version !== undefined && func0.call(data4, 'version')) {
                            const _errs12 = errors;
                            if ('1.0.0' !== data4.version) {
                              validate10.errors = [
                                {
                                  instancePath: instancePath + '/languageRef/version',
                                  schemaPath: '#/properties/languageRef/properties/version/const',
                                  keyword: 'const',
                                  params: { allowedValue: '1.0.0' },
                                  message: 'must be equal to constant',
                                },
                              ];
                              return false;
                            }
                            var valid2 = _errs12 === errors;
                          } else {
                            var valid2 = true;
                          }
                        }
                      }
                    }
                  } else {
                    validate10.errors = [
                      {
                        instancePath: instancePath + '/languageRef',
                        schemaPath: '#/properties/languageRef/type',
                        keyword: 'type',
                        params: { type: 'object' },
                        message: 'must be object',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.engineRef !== undefined && func0.call(data, 'engineRef')) {
                  let data7 = data.engineRef;
                  const _errs13 = errors;
                  if (errors === _errs13) {
                    if (data7 && typeof data7 == 'object' && !Array.isArray(data7)) {
                      let missing3;
                      if (
                        ((data7.id === undefined || !func0.call(data7, 'id')) &&
                          (missing3 = 'id')) ||
                        ((data7.version === undefined || !func0.call(data7, 'version')) &&
                          (missing3 = 'version'))
                      ) {
                        validate10.errors = [
                          {
                            instancePath: instancePath + '/engineRef',
                            schemaPath: '#/properties/engineRef/required',
                            keyword: 'required',
                            params: { missingProperty: missing3 },
                            message: "must have required property '" + missing3 + "'",
                          },
                        ];
                        return false;
                      } else {
                        const _errs15 = errors;
                        for (const key3 of Object.keys(data7)) {
                          if (!(key3 === 'id' || key3 === 'version')) {
                            validate10.errors = [
                              {
                                instancePath: instancePath + '/engineRef',
                                schemaPath: '#/properties/engineRef/additionalProperties',
                                keyword: 'additionalProperties',
                                params: { additionalProperty: key3 },
                                message: 'must NOT have additional properties',
                              },
                            ];
                            return false;
                            break;
                          }
                        }
                        if (_errs15 === errors) {
                          if (data7.id !== undefined && func0.call(data7, 'id')) {
                            const _errs16 = errors;
                            if ('engine.rust.c6' !== data7.id) {
                              validate10.errors = [
                                {
                                  instancePath: instancePath + '/engineRef/id',
                                  schemaPath: '#/properties/engineRef/properties/id/const',
                                  keyword: 'const',
                                  params: { allowedValue: 'engine.rust.c6' },
                                  message: 'must be equal to constant',
                                },
                              ];
                              return false;
                            }
                            var valid3 = _errs16 === errors;
                          } else {
                            var valid3 = true;
                          }
                          if (valid3) {
                            if (data7.version !== undefined && func0.call(data7, 'version')) {
                              const _errs17 = errors;
                              if ('0.1.0' !== data7.version) {
                                validate10.errors = [
                                  {
                                    instancePath: instancePath + '/engineRef/version',
                                    schemaPath: '#/properties/engineRef/properties/version/const',
                                    keyword: 'const',
                                    params: { allowedValue: '0.1.0' },
                                    message: 'must be equal to constant',
                                  },
                                ];
                                return false;
                              }
                              var valid3 = _errs17 === errors;
                            } else {
                              var valid3 = true;
                            }
                          }
                        }
                      }
                    } else {
                      validate10.errors = [
                        {
                          instancePath: instancePath + '/engineRef',
                          schemaPath: '#/properties/engineRef/type',
                          keyword: 'type',
                          params: { type: 'object' },
                          message: 'must be object',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (
                    data.engineBuildSha256 !== undefined &&
                    func0.call(data, 'engineBuildSha256')
                  ) {
                    let data10 = data.engineBuildSha256;
                    const _errs18 = errors;
                    if (errors === _errs18) {
                      if (typeof data10 === 'string') {
                        if (!pattern0.test(data10)) {
                          validate10.errors = [
                            {
                              instancePath: instancePath + '/engineBuildSha256',
                              schemaPath: '#/properties/engineBuildSha256/pattern',
                              keyword: 'pattern',
                              params: { pattern: '^[a-f0-9]{64}$' },
                              message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate10.errors = [
                          {
                            instancePath: instancePath + '/engineBuildSha256',
                            schemaPath: '#/properties/engineBuildSha256/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs18 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (
                      data.judgeOwnerPackageRef !== undefined &&
                      func0.call(data, 'judgeOwnerPackageRef')
                    ) {
                      let data11 = data.judgeOwnerPackageRef;
                      const _errs20 = errors;
                      if (errors === _errs20) {
                        if (data11 && typeof data11 == 'object' && !Array.isArray(data11)) {
                          let missing4;
                          if (
                            ((data11.id === undefined || !func0.call(data11, 'id')) &&
                              (missing4 = 'id')) ||
                            ((data11.version === undefined || !func0.call(data11, 'version')) &&
                              (missing4 = 'version'))
                          ) {
                            validate10.errors = [
                              {
                                instancePath: instancePath + '/judgeOwnerPackageRef',
                                schemaPath: '#/properties/judgeOwnerPackageRef/required',
                                keyword: 'required',
                                params: { missingProperty: missing4 },
                                message: "must have required property '" + missing4 + "'",
                              },
                            ];
                            return false;
                          } else {
                            const _errs22 = errors;
                            for (const key4 of Object.keys(data11)) {
                              if (!(key4 === 'id' || key4 === 'version')) {
                                validate10.errors = [
                                  {
                                    instancePath: instancePath + '/judgeOwnerPackageRef',
                                    schemaPath:
                                      '#/properties/judgeOwnerPackageRef/additionalProperties',
                                    keyword: 'additionalProperties',
                                    params: { additionalProperty: key4 },
                                    message: 'must NOT have additional properties',
                                  },
                                ];
                                return false;
                                break;
                              }
                            }
                            if (_errs22 === errors) {
                              if (data11.id !== undefined && func0.call(data11, 'id')) {
                                const _errs23 = errors;
                                if ('content.c.primer6' !== data11.id) {
                                  validate10.errors = [
                                    {
                                      instancePath: instancePath + '/judgeOwnerPackageRef/id',
                                      schemaPath:
                                        '#/properties/judgeOwnerPackageRef/properties/id/const',
                                      keyword: 'const',
                                      params: { allowedValue: 'content.c.primer6' },
                                      message: 'must be equal to constant',
                                    },
                                  ];
                                  return false;
                                }
                                var valid4 = _errs23 === errors;
                              } else {
                                var valid4 = true;
                              }
                              if (valid4) {
                                if (data11.version !== undefined && func0.call(data11, 'version')) {
                                  const _errs24 = errors;
                                  if ('1.0.0' !== data11.version) {
                                    validate10.errors = [
                                      {
                                        instancePath:
                                          instancePath + '/judgeOwnerPackageRef/version',
                                        schemaPath:
                                          '#/properties/judgeOwnerPackageRef/properties/version/const',
                                        keyword: 'const',
                                        params: { allowedValue: '1.0.0' },
                                        message: 'must be equal to constant',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid4 = _errs24 === errors;
                                } else {
                                  var valid4 = true;
                                }
                              }
                            }
                          }
                        } else {
                          validate10.errors = [
                            {
                              instancePath: instancePath + '/judgeOwnerPackageRef',
                              schemaPath: '#/properties/judgeOwnerPackageRef/type',
                              keyword: 'type',
                              params: { type: 'object' },
                              message: 'must be object',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs20 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (
                        data.judgeContractVersion !== undefined &&
                        func0.call(data, 'judgeContractVersion')
                      ) {
                        const _errs25 = errors;
                        if ('2.0.0' !== data.judgeContractVersion) {
                          validate10.errors = [
                            {
                              instancePath: instancePath + '/judgeContractVersion',
                              schemaPath: '#/properties/judgeContractVersion/const',
                              keyword: 'const',
                              params: { allowedValue: '2.0.0' },
                              message: 'must be equal to constant',
                            },
                          ];
                          return false;
                        }
                        var valid0 = _errs25 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.scopeRevision !== undefined && func0.call(data, 'scopeRevision')) {
                          const _errs26 = errors;
                          if ('user-20261102-full-key-teaching' !== data.scopeRevision) {
                            validate10.errors = [
                              {
                                instancePath: instancePath + '/scopeRevision',
                                schemaPath: '#/properties/scopeRevision/const',
                                keyword: 'const',
                                params: { allowedValue: 'user-20261102-full-key-teaching' },
                                message: 'must be equal to constant',
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs26 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.source !== undefined && func0.call(data, 'source')) {
                            let data16 = data.source;
                            const _errs27 = errors;
                            if (errors === _errs27) {
                              if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
                                let missing5;
                                if (
                                  ((data16.id === undefined || !func0.call(data16, 'id')) &&
                                    (missing5 = 'id')) ||
                                  ((data16.edition === undefined ||
                                    !func0.call(data16, 'edition')) &&
                                    (missing5 = 'edition')) ||
                                  ((data16.sha256 === undefined || !func0.call(data16, 'sha256')) &&
                                    (missing5 = 'sha256'))
                                ) {
                                  validate10.errors = [
                                    {
                                      instancePath: instancePath + '/source',
                                      schemaPath: '#/properties/source/required',
                                      keyword: 'required',
                                      params: { missingProperty: missing5 },
                                      message: "must have required property '" + missing5 + "'",
                                    },
                                  ];
                                  return false;
                                } else {
                                  const _errs29 = errors;
                                  for (const key5 of Object.keys(data16)) {
                                    if (!(
                                      key5 === 'id' ||
                                      key5 === 'edition' ||
                                      key5 === 'sha256'
                                    )) {
                                      validate10.errors = [
                                        {
                                          instancePath: instancePath + '/source',
                                          schemaPath: '#/properties/source/additionalProperties',
                                          keyword: 'additionalProperties',
                                          params: { additionalProperty: key5 },
                                          message: 'must NOT have additional properties',
                                        },
                                      ];
                                      return false;
                                      break;
                                    }
                                  }
                                  if (_errs29 === errors) {
                                    if (data16.id !== undefined && func0.call(data16, 'id')) {
                                      const _errs30 = errors;
                                      if ('source.c.primer6' !== data16.id) {
                                        validate10.errors = [
                                          {
                                            instancePath: instancePath + '/source/id',
                                            schemaPath: '#/properties/source/properties/id/const',
                                            keyword: 'const',
                                            params: { allowedValue: 'source.c.primer6' },
                                            message: 'must be equal to constant',
                                          },
                                        ];
                                        return false;
                                      }
                                      var valid5 = _errs30 === errors;
                                    } else {
                                      var valid5 = true;
                                    }
                                    if (valid5) {
                                      if (
                                        data16.edition !== undefined &&
                                        func0.call(data16, 'edition')
                                      ) {
                                        const _errs31 = errors;
                                        if (6 !== data16.edition) {
                                          validate10.errors = [
                                            {
                                              instancePath: instancePath + '/source/edition',
                                              schemaPath:
                                                '#/properties/source/properties/edition/const',
                                              keyword: 'const',
                                              params: { allowedValue: 6 },
                                              message: 'must be equal to constant',
                                            },
                                          ];
                                          return false;
                                        }
                                        var valid5 = _errs31 === errors;
                                      } else {
                                        var valid5 = true;
                                      }
                                      if (valid5) {
                                        if (
                                          data16.sha256 !== undefined &&
                                          func0.call(data16, 'sha256')
                                        ) {
                                          const _errs32 = errors;
                                          if (
                                            'c23d60af4adb9a6d90a91c0709ae3b94ef32063cfcbe1792d97e99792afd14e6' !==
                                            data16.sha256
                                          ) {
                                            validate10.errors = [
                                              {
                                                instancePath: instancePath + '/source/sha256',
                                                schemaPath:
                                                  '#/properties/source/properties/sha256/const',
                                                keyword: 'const',
                                                params: {
                                                  allowedValue:
                                                    'c23d60af4adb9a6d90a91c0709ae3b94ef32063cfcbe1792d97e99792afd14e6',
                                                },
                                                message: 'must be equal to constant',
                                              },
                                            ];
                                            return false;
                                          }
                                          var valid5 = _errs32 === errors;
                                        } else {
                                          var valid5 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                validate10.errors = [
                                  {
                                    instancePath: instancePath + '/source',
                                    schemaPath: '#/properties/source/type',
                                    keyword: 'type',
                                    params: { type: 'object' },
                                    message: 'must be object',
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs27 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (
                              data.sourceSha256 !== undefined &&
                              func0.call(data, 'sourceSha256')
                            ) {
                              let data20 = data.sourceSha256;
                              const _errs33 = errors;
                              if (errors === _errs33) {
                                if (typeof data20 === 'string') {
                                  if (!pattern0.test(data20)) {
                                    validate10.errors = [
                                      {
                                        instancePath: instancePath + '/sourceSha256',
                                        schemaPath: '#/properties/sourceSha256/pattern',
                                        keyword: 'pattern',
                                        params: { pattern: '^[a-f0-9]{64}$' },
                                        message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate10.errors = [
                                    {
                                      instancePath: instancePath + '/sourceSha256',
                                      schemaPath: '#/properties/sourceSha256/type',
                                      keyword: 'type',
                                      params: { type: 'string' },
                                      message: 'must be string',
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs33 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.counts !== undefined && func0.call(data, 'counts')) {
                                let data21 = data.counts;
                                const _errs35 = errors;
                                if (errors === _errs35) {
                                  if (
                                    data21 &&
                                    typeof data21 == 'object' &&
                                    !Array.isArray(data21)
                                  ) {
                                    let missing6;
                                    if (
                                      ((data21.nodes === undefined ||
                                        !func0.call(data21, 'nodes')) &&
                                        (missing6 = 'nodes')) ||
                                      ((data21.lessons === undefined ||
                                        !func0.call(data21, 'lessons')) &&
                                        (missing6 = 'lessons')) ||
                                      ((data21.teachingBodies === undefined ||
                                        !func0.call(data21, 'teachingBodies')) &&
                                        (missing6 = 'teachingBodies')) ||
                                      ((data21.teachingProgramSlots === undefined ||
                                        !func0.call(data21, 'teachingProgramSlots')) &&
                                        (missing6 = 'teachingProgramSlots')) ||
                                      ((data21.teachingPrograms === undefined ||
                                        !func0.call(data21, 'teachingPrograms')) &&
                                        (missing6 = 'teachingPrograms')) ||
                                      ((data21.concepts === undefined ||
                                        !func0.call(data21, 'concepts')) &&
                                        (missing6 = 'concepts')) ||
                                      ((data21.requiredLessons === undefined ||
                                        !func0.call(data21, 'requiredLessons')) &&
                                        (missing6 = 'requiredLessons')) ||
                                      ((data21.directoryContainers === undefined ||
                                        !func0.call(data21, 'directoryContainers')) &&
                                        (missing6 = 'directoryContainers')) ||
                                      ((data21.exerciseGroupContainers === undefined ||
                                        !func0.call(data21, 'exerciseGroupContainers')) &&
                                        (missing6 = 'exerciseGroupContainers')) ||
                                      ((data21.referenceNodes === undefined ||
                                        !func0.call(data21, 'referenceNodes')) &&
                                        (missing6 = 'referenceNodes')) ||
                                      ((data21.activities === undefined ||
                                        !func0.call(data21, 'activities')) &&
                                        (missing6 = 'activities')) ||
                                      ((data21.requiredActivities === undefined ||
                                        !func0.call(data21, 'requiredActivities')) &&
                                        (missing6 = 'requiredActivities')) ||
                                      ((data21.optionalActivities === undefined ||
                                        !func0.call(data21, 'optionalActivities')) &&
                                        (missing6 = 'optionalActivities')) ||
                                      ((data21.sourceReviewGuides === undefined ||
                                        !func0.call(data21, 'sourceReviewGuides')) &&
                                        (missing6 = 'sourceReviewGuides')) ||
                                      ((data21.sourceProgrammingGuides === undefined ||
                                        !func0.call(data21, 'sourceProgrammingGuides')) &&
                                        (missing6 = 'sourceProgrammingGuides')) ||
                                      ((data21.executionExercises === undefined ||
                                        !func0.call(data21, 'executionExercises')) &&
                                        (missing6 = 'executionExercises')) ||
                                      ((data21.judgeGroups === undefined ||
                                        !func0.call(data21, 'judgeGroups')) &&
                                        (missing6 = 'judgeGroups')) ||
                                      ((data21.examples === undefined ||
                                        !func0.call(data21, 'examples')) &&
                                        (missing6 = 'examples')) ||
                                      ((data21.executableExamples === undefined ||
                                        !func0.call(data21, 'executableExamples')) &&
                                        (missing6 = 'executableExamples')) ||
                                      ((data21.diagnosticExamples === undefined ||
                                        !func0.call(data21, 'diagnosticExamples')) &&
                                        (missing6 = 'diagnosticExamples')) ||
                                      ((data21.readingExamples === undefined ||
                                        !func0.call(data21, 'readingExamples')) &&
                                        (missing6 = 'readingExamples')) ||
                                      ((data21.knowledgeNodes === undefined ||
                                        !func0.call(data21, 'knowledgeNodes')) &&
                                        (missing6 = 'knowledgeNodes')) ||
                                      ((data21.lazyChunks === undefined ||
                                        !func0.call(data21, 'lazyChunks')) &&
                                        (missing6 = 'lazyChunks'))
                                    ) {
                                      validate10.errors = [
                                        {
                                          instancePath: instancePath + '/counts',
                                          schemaPath: '#/properties/counts/required',
                                          keyword: 'required',
                                          params: { missingProperty: missing6 },
                                          message: "must have required property '" + missing6 + "'",
                                        },
                                      ];
                                      return false;
                                    } else {
                                      const _errs37 = errors;
                                      for (const key6 of Object.keys(data21)) {
                                        if (
                                          !func0.call(schema11.properties.counts.properties, key6)
                                        ) {
                                          validate10.errors = [
                                            {
                                              instancePath: instancePath + '/counts',
                                              schemaPath:
                                                '#/properties/counts/additionalProperties',
                                              keyword: 'additionalProperties',
                                              params: { additionalProperty: key6 },
                                              message: 'must NOT have additional properties',
                                            },
                                          ];
                                          return false;
                                          break;
                                        }
                                      }
                                      if (_errs37 === errors) {
                                        if (
                                          data21.nodes !== undefined &&
                                          func0.call(data21, 'nodes')
                                        ) {
                                          const _errs38 = errors;
                                          if (650 !== data21.nodes) {
                                            validate10.errors = [
                                              {
                                                instancePath: instancePath + '/counts/nodes',
                                                schemaPath:
                                                  '#/properties/counts/properties/nodes/const',
                                                keyword: 'const',
                                                params: { allowedValue: 650 },
                                                message: 'must be equal to constant',
                                              },
                                            ];
                                            return false;
                                          }
                                          var valid6 = _errs38 === errors;
                                        } else {
                                          var valid6 = true;
                                        }
                                        if (valid6) {
                                          if (
                                            data21.lessons !== undefined &&
                                            func0.call(data21, 'lessons')
                                          ) {
                                            const _errs39 = errors;
                                            if (404 !== data21.lessons) {
                                              validate10.errors = [
                                                {
                                                  instancePath: instancePath + '/counts/lessons',
                                                  schemaPath:
                                                    '#/properties/counts/properties/lessons/const',
                                                  keyword: 'const',
                                                  params: { allowedValue: 404 },
                                                  message: 'must be equal to constant',
                                                },
                                              ];
                                              return false;
                                            }
                                            var valid6 = _errs39 === errors;
                                          } else {
                                            var valid6 = true;
                                          }
                                          if (valid6) {
                                            if (
                                              data21.teachingBodies !== undefined &&
                                              func0.call(data21, 'teachingBodies')
                                            ) {
                                              const _errs40 = errors;
                                              if (505 !== data21.teachingBodies) {
                                                validate10.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/counts/teachingBodies',
                                                    schemaPath:
                                                      '#/properties/counts/properties/teachingBodies/const',
                                                    keyword: 'const',
                                                    params: { allowedValue: 505 },
                                                    message: 'must be equal to constant',
                                                  },
                                                ];
                                                return false;
                                              }
                                              var valid6 = _errs40 === errors;
                                            } else {
                                              var valid6 = true;
                                            }
                                            if (valid6) {
                                              if (
                                                data21.teachingProgramSlots !== undefined &&
                                                func0.call(data21, 'teachingProgramSlots')
                                              ) {
                                                const _errs41 = errors;
                                                if (576 !== data21.teachingProgramSlots) {
                                                  validate10.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath +
                                                        '/counts/teachingProgramSlots',
                                                      schemaPath:
                                                        '#/properties/counts/properties/teachingProgramSlots/const',
                                                      keyword: 'const',
                                                      params: { allowedValue: 576 },
                                                      message: 'must be equal to constant',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                                var valid6 = _errs41 === errors;
                                              } else {
                                                var valid6 = true;
                                              }
                                              if (valid6) {
                                                if (
                                                  data21.teachingPrograms !== undefined &&
                                                  func0.call(data21, 'teachingPrograms')
                                                ) {
                                                  const _errs42 = errors;
                                                  if (386 !== data21.teachingPrograms) {
                                                    validate10.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath + '/counts/teachingPrograms',
                                                        schemaPath:
                                                          '#/properties/counts/properties/teachingPrograms/const',
                                                        keyword: 'const',
                                                        params: { allowedValue: 386 },
                                                        message: 'must be equal to constant',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                  var valid6 = _errs42 === errors;
                                                } else {
                                                  var valid6 = true;
                                                }
                                                if (valid6) {
                                                  if (
                                                    data21.concepts !== undefined &&
                                                    func0.call(data21, 'concepts')
                                                  ) {
                                                    const _errs43 = errors;
                                                    if (0 !== data21.concepts) {
                                                      validate10.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath + '/counts/concepts',
                                                          schemaPath:
                                                            '#/properties/counts/properties/concepts/const',
                                                          keyword: 'const',
                                                          params: { allowedValue: 0 },
                                                          message: 'must be equal to constant',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                    var valid6 = _errs43 === errors;
                                                  } else {
                                                    var valid6 = true;
                                                  }
                                                  if (valid6) {
                                                    if (
                                                      data21.requiredLessons !== undefined &&
                                                      func0.call(data21, 'requiredLessons')
                                                    ) {
                                                      const _errs44 = errors;
                                                      if (404 !== data21.requiredLessons) {
                                                        validate10.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath +
                                                              '/counts/requiredLessons',
                                                            schemaPath:
                                                              '#/properties/counts/properties/requiredLessons/const',
                                                            keyword: 'const',
                                                            params: { allowedValue: 404 },
                                                            message: 'must be equal to constant',
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                      var valid6 = _errs44 === errors;
                                                    } else {
                                                      var valid6 = true;
                                                    }
                                                    if (valid6) {
                                                      if (
                                                        data21.directoryContainers !== undefined &&
                                                        func0.call(data21, 'directoryContainers')
                                                      ) {
                                                        const _errs45 = errors;
                                                        if (112 !== data21.directoryContainers) {
                                                          validate10.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath +
                                                                '/counts/directoryContainers',
                                                              schemaPath:
                                                                '#/properties/counts/properties/directoryContainers/const',
                                                              keyword: 'const',
                                                              params: { allowedValue: 112 },
                                                              message: 'must be equal to constant',
                                                            },
                                                          ];
                                                          return false;
                                                        }
                                                        var valid6 = _errs45 === errors;
                                                      } else {
                                                        var valid6 = true;
                                                      }
                                                      if (valid6) {
                                                        if (
                                                          data21.exerciseGroupContainers !==
                                                            undefined &&
                                                          func0.call(
                                                            data21,
                                                            'exerciseGroupContainers',
                                                          )
                                                        ) {
                                                          const _errs46 = errors;
                                                          if (
                                                            34 !== data21.exerciseGroupContainers
                                                          ) {
                                                            validate10.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath +
                                                                  '/counts/exerciseGroupContainers',
                                                                schemaPath:
                                                                  '#/properties/counts/properties/exerciseGroupContainers/const',
                                                                keyword: 'const',
                                                                params: { allowedValue: 34 },
                                                                message:
                                                                  'must be equal to constant',
                                                              },
                                                            ];
                                                            return false;
                                                          }
                                                          var valid6 = _errs46 === errors;
                                                        } else {
                                                          var valid6 = true;
                                                        }
                                                        if (valid6) {
                                                          if (
                                                            data21.referenceNodes !== undefined &&
                                                            func0.call(data21, 'referenceNodes')
                                                          ) {
                                                            const _errs47 = errors;
                                                            if (111 !== data21.referenceNodes) {
                                                              validate10.errors = [
                                                                {
                                                                  instancePath:
                                                                    instancePath +
                                                                    '/counts/referenceNodes',
                                                                  schemaPath:
                                                                    '#/properties/counts/properties/referenceNodes/const',
                                                                  keyword: 'const',
                                                                  params: { allowedValue: 111 },
                                                                  message:
                                                                    'must be equal to constant',
                                                                },
                                                              ];
                                                              return false;
                                                            }
                                                            var valid6 = _errs47 === errors;
                                                          } else {
                                                            var valid6 = true;
                                                          }
                                                          if (valid6) {
                                                            if (
                                                              data21.activities !== undefined &&
                                                              func0.call(data21, 'activities')
                                                            ) {
                                                              const _errs48 = errors;
                                                              if (389 !== data21.activities) {
                                                                validate10.errors = [
                                                                  {
                                                                    instancePath:
                                                                      instancePath +
                                                                      '/counts/activities',
                                                                    schemaPath:
                                                                      '#/properties/counts/properties/activities/const',
                                                                    keyword: 'const',
                                                                    params: { allowedValue: 389 },
                                                                    message:
                                                                      'must be equal to constant',
                                                                  },
                                                                ];
                                                                return false;
                                                              }
                                                              var valid6 = _errs48 === errors;
                                                            } else {
                                                              var valid6 = true;
                                                            }
                                                            if (valid6) {
                                                              if (
                                                                data21.requiredActivities !==
                                                                  undefined &&
                                                                func0.call(
                                                                  data21,
                                                                  'requiredActivities',
                                                                )
                                                              ) {
                                                                const _errs49 = errors;
                                                                if (
                                                                  44 !== data21.requiredActivities
                                                                ) {
                                                                  validate10.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/counts/requiredActivities',
                                                                      schemaPath:
                                                                        '#/properties/counts/properties/requiredActivities/const',
                                                                      keyword: 'const',
                                                                      params: { allowedValue: 44 },
                                                                      message:
                                                                        'must be equal to constant',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                }
                                                                var valid6 = _errs49 === errors;
                                                              } else {
                                                                var valid6 = true;
                                                              }
                                                              if (valid6) {
                                                                if (
                                                                  data21.optionalActivities !==
                                                                    undefined &&
                                                                  func0.call(
                                                                    data21,
                                                                    'optionalActivities',
                                                                  )
                                                                ) {
                                                                  const _errs50 = errors;
                                                                  if (
                                                                    345 !==
                                                                    data21.optionalActivities
                                                                  ) {
                                                                    validate10.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/counts/optionalActivities',
                                                                        schemaPath:
                                                                          '#/properties/counts/properties/optionalActivities/const',
                                                                        keyword: 'const',
                                                                        params: {
                                                                          allowedValue: 345,
                                                                        },
                                                                        message:
                                                                          'must be equal to constant',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  }
                                                                  var valid6 = _errs50 === errors;
                                                                } else {
                                                                  var valid6 = true;
                                                                }
                                                                if (valid6) {
                                                                  if (
                                                                    data21.sourceReviewGuides !==
                                                                      undefined &&
                                                                    func0.call(
                                                                      data21,
                                                                      'sourceReviewGuides',
                                                                    )
                                                                  ) {
                                                                    const _errs51 = errors;
                                                                    if (
                                                                      177 !==
                                                                      data21.sourceReviewGuides
                                                                    ) {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/counts/sourceReviewGuides',
                                                                          schemaPath:
                                                                            '#/properties/counts/properties/sourceReviewGuides/const',
                                                                          keyword: 'const',
                                                                          params: {
                                                                            allowedValue: 177,
                                                                          },
                                                                          message:
                                                                            'must be equal to constant',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                    var valid6 = _errs51 === errors;
                                                                  } else {
                                                                    var valid6 = true;
                                                                  }
                                                                  if (valid6) {
                                                                    if (
                                                                      data21.sourceProgrammingGuides !==
                                                                        undefined &&
                                                                      func0.call(
                                                                        data21,
                                                                        'sourceProgrammingGuides',
                                                                      )
                                                                    ) {
                                                                      const _errs52 = errors;
                                                                      if (
                                                                        168 !==
                                                                        data21.sourceProgrammingGuides
                                                                      ) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/counts/sourceProgrammingGuides',
                                                                            schemaPath:
                                                                              '#/properties/counts/properties/sourceProgrammingGuides/const',
                                                                            keyword: 'const',
                                                                            params: {
                                                                              allowedValue: 168,
                                                                            },
                                                                            message:
                                                                              'must be equal to constant',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                      var valid6 =
                                                                        _errs52 === errors;
                                                                    } else {
                                                                      var valid6 = true;
                                                                    }
                                                                    if (valid6) {
                                                                      if (
                                                                        data21.executionExercises !==
                                                                          undefined &&
                                                                        func0.call(
                                                                          data21,
                                                                          'executionExercises',
                                                                        )
                                                                      ) {
                                                                        const _errs53 = errors;
                                                                        if (
                                                                          44 !==
                                                                          data21.executionExercises
                                                                        ) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/counts/executionExercises',
                                                                              schemaPath:
                                                                                '#/properties/counts/properties/executionExercises/const',
                                                                              keyword: 'const',
                                                                              params: {
                                                                                allowedValue: 44,
                                                                              },
                                                                              message:
                                                                                'must be equal to constant',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                        var valid6 =
                                                                          _errs53 === errors;
                                                                      } else {
                                                                        var valid6 = true;
                                                                      }
                                                                      if (valid6) {
                                                                        if (
                                                                          data21.judgeGroups !==
                                                                            undefined &&
                                                                          func0.call(
                                                                            data21,
                                                                            'judgeGroups',
                                                                          )
                                                                        ) {
                                                                          const _errs54 = errors;
                                                                          if (
                                                                            176 !==
                                                                            data21.judgeGroups
                                                                          ) {
                                                                            validate10.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/counts/judgeGroups',
                                                                                schemaPath:
                                                                                  '#/properties/counts/properties/judgeGroups/const',
                                                                                keyword: 'const',
                                                                                params: {
                                                                                  allowedValue: 176,
                                                                                },
                                                                                message:
                                                                                  'must be equal to constant',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                          var valid6 =
                                                                            _errs54 === errors;
                                                                        } else {
                                                                          var valid6 = true;
                                                                        }
                                                                        if (valid6) {
                                                                          if (
                                                                            data21.examples !==
                                                                              undefined &&
                                                                            func0.call(
                                                                              data21,
                                                                              'examples',
                                                                            )
                                                                          ) {
                                                                            const _errs55 = errors;
                                                                            if (
                                                                              232 !==
                                                                              data21.examples
                                                                            ) {
                                                                              validate10.errors = [
                                                                                {
                                                                                  instancePath:
                                                                                    instancePath +
                                                                                    '/counts/examples',
                                                                                  schemaPath:
                                                                                    '#/properties/counts/properties/examples/const',
                                                                                  keyword: 'const',
                                                                                  params: {
                                                                                    allowedValue: 232,
                                                                                  },
                                                                                  message:
                                                                                    'must be equal to constant',
                                                                                },
                                                                              ];
                                                                              return false;
                                                                            }
                                                                            var valid6 =
                                                                              _errs55 === errors;
                                                                          } else {
                                                                            var valid6 = true;
                                                                          }
                                                                          if (valid6) {
                                                                            if (
                                                                              data21.executableExamples !==
                                                                                undefined &&
                                                                              func0.call(
                                                                                data21,
                                                                                'executableExamples',
                                                                              )
                                                                            ) {
                                                                              const _errs56 =
                                                                                errors;
                                                                              if (
                                                                                124 !==
                                                                                data21.executableExamples
                                                                              ) {
                                                                                validate10.errors =
                                                                                  [
                                                                                    {
                                                                                      instancePath:
                                                                                        instancePath +
                                                                                        '/counts/executableExamples',
                                                                                      schemaPath:
                                                                                        '#/properties/counts/properties/executableExamples/const',
                                                                                      keyword:
                                                                                        'const',
                                                                                      params: {
                                                                                        allowedValue: 124,
                                                                                      },
                                                                                      message:
                                                                                        'must be equal to constant',
                                                                                    },
                                                                                  ];
                                                                                return false;
                                                                              }
                                                                              var valid6 =
                                                                                _errs56 === errors;
                                                                            } else {
                                                                              var valid6 = true;
                                                                            }
                                                                            if (valid6) {
                                                                              if (
                                                                                data21.diagnosticExamples !==
                                                                                  undefined &&
                                                                                func0.call(
                                                                                  data21,
                                                                                  'diagnosticExamples',
                                                                                )
                                                                              ) {
                                                                                const _errs57 =
                                                                                  errors;
                                                                                if (
                                                                                  7 !==
                                                                                  data21.diagnosticExamples
                                                                                ) {
                                                                                  validate10.errors =
                                                                                    [
                                                                                      {
                                                                                        instancePath:
                                                                                          instancePath +
                                                                                          '/counts/diagnosticExamples',
                                                                                        schemaPath:
                                                                                          '#/properties/counts/properties/diagnosticExamples/const',
                                                                                        keyword:
                                                                                          'const',
                                                                                        params: {
                                                                                          allowedValue: 7,
                                                                                        },
                                                                                        message:
                                                                                          'must be equal to constant',
                                                                                      },
                                                                                    ];
                                                                                  return false;
                                                                                }
                                                                                var valid6 =
                                                                                  _errs57 ===
                                                                                  errors;
                                                                              } else {
                                                                                var valid6 = true;
                                                                              }
                                                                              if (valid6) {
                                                                                if (
                                                                                  data21.readingExamples !==
                                                                                    undefined &&
                                                                                  func0.call(
                                                                                    data21,
                                                                                    'readingExamples',
                                                                                  )
                                                                                ) {
                                                                                  const _errs58 =
                                                                                    errors;
                                                                                  if (
                                                                                    101 !==
                                                                                    data21.readingExamples
                                                                                  ) {
                                                                                    validate10.errors =
                                                                                      [
                                                                                        {
                                                                                          instancePath:
                                                                                            instancePath +
                                                                                            '/counts/readingExamples',
                                                                                          schemaPath:
                                                                                            '#/properties/counts/properties/readingExamples/const',
                                                                                          keyword:
                                                                                            'const',
                                                                                          params: {
                                                                                            allowedValue: 101,
                                                                                          },
                                                                                          message:
                                                                                            'must be equal to constant',
                                                                                        },
                                                                                      ];
                                                                                    return false;
                                                                                  }
                                                                                  var valid6 =
                                                                                    _errs58 ===
                                                                                    errors;
                                                                                } else {
                                                                                  var valid6 = true;
                                                                                }
                                                                                if (valid6) {
                                                                                  if (
                                                                                    data21.knowledgeNodes !==
                                                                                      undefined &&
                                                                                    func0.call(
                                                                                      data21,
                                                                                      'knowledgeNodes',
                                                                                    )
                                                                                  ) {
                                                                                    const _errs59 =
                                                                                      errors;
                                                                                    if (
                                                                                      421 !==
                                                                                      data21.knowledgeNodes
                                                                                    ) {
                                                                                      validate10.errors =
                                                                                        [
                                                                                          {
                                                                                            instancePath:
                                                                                              instancePath +
                                                                                              '/counts/knowledgeNodes',
                                                                                            schemaPath:
                                                                                              '#/properties/counts/properties/knowledgeNodes/const',
                                                                                            keyword:
                                                                                              'const',
                                                                                            params:
                                                                                              {
                                                                                                allowedValue: 421,
                                                                                              },
                                                                                            message:
                                                                                              'must be equal to constant',
                                                                                          },
                                                                                        ];
                                                                                      return false;
                                                                                    }
                                                                                    var valid6 =
                                                                                      _errs59 ===
                                                                                      errors;
                                                                                  } else {
                                                                                    var valid6 = true;
                                                                                  }
                                                                                  if (valid6) {
                                                                                    if (
                                                                                      data21.lazyChunks !==
                                                                                        undefined &&
                                                                                      func0.call(
                                                                                        data21,
                                                                                        'lazyChunks',
                                                                                      )
                                                                                    ) {
                                                                                      const _errs60 =
                                                                                        errors;
                                                                                      if (
                                                                                        19 !==
                                                                                        data21.lazyChunks
                                                                                      ) {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/counts/lazyChunks',
                                                                                              schemaPath:
                                                                                                '#/properties/counts/properties/lazyChunks/const',
                                                                                              keyword:
                                                                                                'const',
                                                                                              params:
                                                                                                {
                                                                                                  allowedValue: 19,
                                                                                                },
                                                                                              message:
                                                                                                'must be equal to constant',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      }
                                                                                      var valid6 =
                                                                                        _errs60 ===
                                                                                        errors;
                                                                                    } else {
                                                                                      var valid6 = true;
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else {
                                    validate10.errors = [
                                      {
                                        instancePath: instancePath + '/counts',
                                        schemaPath: '#/properties/counts/type',
                                        keyword: 'type',
                                        params: { type: 'object' },
                                        message: 'must be object',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs35 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.budgets !== undefined && func0.call(data, 'budgets')) {
                                  let data45 = data.budgets;
                                  const _errs61 = errors;
                                  if (errors === _errs61) {
                                    if (
                                      data45 &&
                                      typeof data45 == 'object' &&
                                      !Array.isArray(data45)
                                    ) {
                                      let missing7;
                                      if (
                                        ((data45.packageBytes === undefined ||
                                          !func0.call(data45, 'packageBytes')) &&
                                          (missing7 = 'packageBytes')) ||
                                        ((data45.manifestBytes === undefined ||
                                          !func0.call(data45, 'manifestBytes')) &&
                                          (missing7 = 'manifestBytes')) ||
                                        ((data45.chunkBytes === undefined ||
                                          !func0.call(data45, 'chunkBytes')) &&
                                          (missing7 = 'chunkBytes')) ||
                                        ((data45.sourceBytes === undefined ||
                                          !func0.call(data45, 'sourceBytes')) &&
                                          (missing7 = 'sourceBytes'))
                                      ) {
                                        validate10.errors = [
                                          {
                                            instancePath: instancePath + '/budgets',
                                            schemaPath: '#/properties/budgets/required',
                                            keyword: 'required',
                                            params: { missingProperty: missing7 },
                                            message:
                                              "must have required property '" + missing7 + "'",
                                          },
                                        ];
                                        return false;
                                      } else {
                                        const _errs63 = errors;
                                        for (const key7 of Object.keys(data45)) {
                                          if (!(
                                            key7 === 'packageBytes' ||
                                            key7 === 'manifestBytes' ||
                                            key7 === 'chunkBytes' ||
                                            key7 === 'sourceBytes'
                                          )) {
                                            validate10.errors = [
                                              {
                                                instancePath: instancePath + '/budgets',
                                                schemaPath:
                                                  '#/properties/budgets/additionalProperties',
                                                keyword: 'additionalProperties',
                                                params: { additionalProperty: key7 },
                                                message: 'must NOT have additional properties',
                                              },
                                            ];
                                            return false;
                                            break;
                                          }
                                        }
                                        if (_errs63 === errors) {
                                          if (
                                            data45.packageBytes !== undefined &&
                                            func0.call(data45, 'packageBytes')
                                          ) {
                                            const _errs64 = errors;
                                            if (20971520 !== data45.packageBytes) {
                                              validate10.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + '/budgets/packageBytes',
                                                  schemaPath:
                                                    '#/properties/budgets/properties/packageBytes/const',
                                                  keyword: 'const',
                                                  params: { allowedValue: 20971520 },
                                                  message: 'must be equal to constant',
                                                },
                                              ];
                                              return false;
                                            }
                                            var valid7 = _errs64 === errors;
                                          } else {
                                            var valid7 = true;
                                          }
                                          if (valid7) {
                                            if (
                                              data45.manifestBytes !== undefined &&
                                              func0.call(data45, 'manifestBytes')
                                            ) {
                                              const _errs65 = errors;
                                              if (262144 !== data45.manifestBytes) {
                                                validate10.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/budgets/manifestBytes',
                                                    schemaPath:
                                                      '#/properties/budgets/properties/manifestBytes/const',
                                                    keyword: 'const',
                                                    params: { allowedValue: 262144 },
                                                    message: 'must be equal to constant',
                                                  },
                                                ];
                                                return false;
                                              }
                                              var valid7 = _errs65 === errors;
                                            } else {
                                              var valid7 = true;
                                            }
                                            if (valid7) {
                                              if (
                                                data45.chunkBytes !== undefined &&
                                                func0.call(data45, 'chunkBytes')
                                              ) {
                                                const _errs66 = errors;
                                                if (1048576 !== data45.chunkBytes) {
                                                  validate10.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath + '/budgets/chunkBytes',
                                                      schemaPath:
                                                        '#/properties/budgets/properties/chunkBytes/const',
                                                      keyword: 'const',
                                                      params: { allowedValue: 1048576 },
                                                      message: 'must be equal to constant',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                                var valid7 = _errs66 === errors;
                                              } else {
                                                var valid7 = true;
                                              }
                                              if (valid7) {
                                                if (
                                                  data45.sourceBytes !== undefined &&
                                                  func0.call(data45, 'sourceBytes')
                                                ) {
                                                  const _errs67 = errors;
                                                  if (32768 !== data45.sourceBytes) {
                                                    validate10.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath + '/budgets/sourceBytes',
                                                        schemaPath:
                                                          '#/properties/budgets/properties/sourceBytes/const',
                                                        keyword: 'const',
                                                        params: { allowedValue: 32768 },
                                                        message: 'must be equal to constant',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                  var valid7 = _errs67 === errors;
                                                } else {
                                                  var valid7 = true;
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    } else {
                                      validate10.errors = [
                                        {
                                          instancePath: instancePath + '/budgets',
                                          schemaPath: '#/properties/budgets/type',
                                          keyword: 'type',
                                          params: { type: 'object' },
                                          message: 'must be object',
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                  var valid0 = _errs61 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (
                                    data.compatibilityChunkId !== undefined &&
                                    func0.call(data, 'compatibilityChunkId')
                                  ) {
                                    const _errs68 = errors;
                                    if ('chA' !== data.compatibilityChunkId) {
                                      validate10.errors = [
                                        {
                                          instancePath: instancePath + '/compatibilityChunkId',
                                          schemaPath: '#/properties/compatibilityChunkId/const',
                                          keyword: 'const',
                                          params: { allowedValue: 'chA' },
                                          message: 'must be equal to constant',
                                        },
                                      ];
                                      return false;
                                    }
                                    var valid0 = _errs68 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.chunks !== undefined && func0.call(data, 'chunks')) {
                                      let data51 = data.chunks;
                                      const _errs69 = errors;
                                      if (errors === _errs69) {
                                        if (Array.isArray(data51)) {
                                          if (data51.length > 19) {
                                            validate10.errors = [
                                              {
                                                instancePath: instancePath + '/chunks',
                                                schemaPath: '#/properties/chunks/maxItems',
                                                keyword: 'maxItems',
                                                params: { limit: 19 },
                                                message: 'must NOT have more than 19 items',
                                              },
                                            ];
                                            return false;
                                          } else {
                                            if (data51.length < 19) {
                                              validate10.errors = [
                                                {
                                                  instancePath: instancePath + '/chunks',
                                                  schemaPath: '#/properties/chunks/minItems',
                                                  keyword: 'minItems',
                                                  params: { limit: 19 },
                                                  message: 'must NOT have fewer than 19 items',
                                                },
                                              ];
                                              return false;
                                            } else {
                                              var valid8 = true;
                                              const len0 = data51.length;
                                              for (let i0 = 0; i0 < len0; i0++) {
                                                let data52 = data51[i0];
                                                const _errs71 = errors;
                                                if (errors === _errs71) {
                                                  if (
                                                    data52 &&
                                                    typeof data52 == 'object' &&
                                                    !Array.isArray(data52)
                                                  ) {
                                                    let missing8;
                                                    if (
                                                      ((data52.id === undefined ||
                                                        !func0.call(data52, 'id')) &&
                                                        (missing8 = 'id')) ||
                                                      ((data52.kind === undefined ||
                                                        !func0.call(data52, 'kind')) &&
                                                        (missing8 = 'kind')) ||
                                                      ((data52.rootNodeId === undefined ||
                                                        !func0.call(data52, 'rootNodeId')) &&
                                                        (missing8 = 'rootNodeId')) ||
                                                      ((data52.file === undefined ||
                                                        !func0.call(data52, 'file')) &&
                                                        (missing8 = 'file')) ||
                                                      ((data52.bytes === undefined ||
                                                        !func0.call(data52, 'bytes')) &&
                                                        (missing8 = 'bytes')) ||
                                                      ((data52.sha256 === undefined ||
                                                        !func0.call(data52, 'sha256')) &&
                                                        (missing8 = 'sha256')) ||
                                                      ((data52.counts === undefined ||
                                                        !func0.call(data52, 'counts')) &&
                                                        (missing8 = 'counts')) ||
                                                      ((data52.entityIds === undefined ||
                                                        !func0.call(data52, 'entityIds')) &&
                                                        (missing8 = 'entityIds'))
                                                    ) {
                                                      validate10.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath + '/chunks/' + i0,
                                                          schemaPath:
                                                            '#/properties/chunks/items/required',
                                                          keyword: 'required',
                                                          params: { missingProperty: missing8 },
                                                          message:
                                                            "must have required property '" +
                                                            missing8 +
                                                            "'",
                                                        },
                                                      ];
                                                      return false;
                                                    } else {
                                                      const _errs73 = errors;
                                                      for (const key8 of Object.keys(data52)) {
                                                        if (!(
                                                          key8 === 'id' ||
                                                          key8 === 'kind' ||
                                                          key8 === 'rootNodeId' ||
                                                          key8 === 'file' ||
                                                          key8 === 'bytes' ||
                                                          key8 === 'sha256' ||
                                                          key8 === 'counts' ||
                                                          key8 === 'entityIds'
                                                        )) {
                                                          validate10.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath + '/chunks/' + i0,
                                                              schemaPath:
                                                                '#/properties/chunks/items/additionalProperties',
                                                              keyword: 'additionalProperties',
                                                              params: { additionalProperty: key8 },
                                                              message:
                                                                'must NOT have additional properties',
                                                            },
                                                          ];
                                                          return false;
                                                          break;
                                                        }
                                                      }
                                                      if (_errs73 === errors) {
                                                        if (
                                                          data52.id !== undefined &&
                                                          func0.call(data52, 'id')
                                                        ) {
                                                          let data53 = data52.id;
                                                          const _errs74 = errors;
                                                          if (!(
                                                            data53 === 'ch01' ||
                                                            data53 === 'ch02' ||
                                                            data53 === 'ch03' ||
                                                            data53 === 'ch04' ||
                                                            data53 === 'ch05' ||
                                                            data53 === 'ch06' ||
                                                            data53 === 'ch07' ||
                                                            data53 === 'ch08' ||
                                                            data53 === 'ch09' ||
                                                            data53 === 'ch10' ||
                                                            data53 === 'ch11' ||
                                                            data53 === 'ch12' ||
                                                            data53 === 'ch13' ||
                                                            data53 === 'ch14' ||
                                                            data53 === 'ch15' ||
                                                            data53 === 'ch16' ||
                                                            data53 === 'ch17' ||
                                                            data53 === 'chA' ||
                                                            data53 === 'chB'
                                                          )) {
                                                            validate10.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath +
                                                                  '/chunks/' +
                                                                  i0 +
                                                                  '/id',
                                                                schemaPath:
                                                                  '#/properties/chunks/items/properties/id/enum',
                                                                keyword: 'enum',
                                                                params: {
                                                                  allowedValues:
                                                                    schema11.properties.chunks.items
                                                                      .properties.id.enum,
                                                                },
                                                                message:
                                                                  'must be equal to one of the allowed values',
                                                              },
                                                            ];
                                                            return false;
                                                          }
                                                          var valid9 = _errs74 === errors;
                                                        } else {
                                                          var valid9 = true;
                                                        }
                                                        if (valid9) {
                                                          if (
                                                            data52.kind !== undefined &&
                                                            func0.call(data52, 'kind')
                                                          ) {
                                                            let data54 = data52.kind;
                                                            const _errs75 = errors;
                                                            if (!(
                                                              data54 === 'course-chapter' ||
                                                              data54 === 'reference-appendix'
                                                            )) {
                                                              validate10.errors = [
                                                                {
                                                                  instancePath:
                                                                    instancePath +
                                                                    '/chunks/' +
                                                                    i0 +
                                                                    '/kind',
                                                                  schemaPath:
                                                                    '#/properties/chunks/items/properties/kind/enum',
                                                                  keyword: 'enum',
                                                                  params: {
                                                                    allowedValues:
                                                                      schema11.properties.chunks
                                                                        .items.properties.kind.enum,
                                                                  },
                                                                  message:
                                                                    'must be equal to one of the allowed values',
                                                                },
                                                              ];
                                                              return false;
                                                            }
                                                            var valid9 = _errs75 === errors;
                                                          } else {
                                                            var valid9 = true;
                                                          }
                                                          if (valid9) {
                                                            if (
                                                              data52.rootNodeId !== undefined &&
                                                              func0.call(data52, 'rootNodeId')
                                                            ) {
                                                              let data55 = data52.rootNodeId;
                                                              const _errs76 = errors;
                                                              if (errors === _errs76) {
                                                                if (typeof data55 === 'string') {
                                                                  if (func163(data55) > 80) {
                                                                    validate10.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/chunks/' +
                                                                          i0 +
                                                                          '/rootNodeId',
                                                                        schemaPath:
                                                                          '#/properties/chunks/items/properties/rootNodeId/maxLength',
                                                                        keyword: 'maxLength',
                                                                        params: { limit: 80 },
                                                                        message:
                                                                          'must NOT have more than 80 characters',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  } else {
                                                                    if (func163(data55) < 1) {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/chunks/' +
                                                                            i0 +
                                                                            '/rootNodeId',
                                                                          schemaPath:
                                                                            '#/properties/chunks/items/properties/rootNodeId/minLength',
                                                                          keyword: 'minLength',
                                                                          params: { limit: 1 },
                                                                          message:
                                                                            'must NOT have fewer than 1 characters',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    } else {
                                                                      if (!pattern2.test(data55)) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/chunks/' +
                                                                              i0 +
                                                                              '/rootNodeId',
                                                                            schemaPath:
                                                                              '#/properties/chunks/items/properties/rootNodeId/pattern',
                                                                            keyword: 'pattern',
                                                                            params: {
                                                                              pattern:
                                                                                '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
                                                                            },
                                                                            message:
                                                                              'must match pattern "' +
                                                                              '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$' +
                                                                              '"',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                  }
                                                                } else {
                                                                  validate10.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/chunks/' +
                                                                        i0 +
                                                                        '/rootNodeId',
                                                                      schemaPath:
                                                                        '#/properties/chunks/items/properties/rootNodeId/type',
                                                                      keyword: 'type',
                                                                      params: { type: 'string' },
                                                                      message: 'must be string',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                }
                                                              }
                                                              var valid9 = _errs76 === errors;
                                                            } else {
                                                              var valid9 = true;
                                                            }
                                                            if (valid9) {
                                                              if (
                                                                data52.file !== undefined &&
                                                                func0.call(data52, 'file')
                                                              ) {
                                                                let data56 = data52.file;
                                                                const _errs78 = errors;
                                                                if (errors === _errs78) {
                                                                  if (typeof data56 === 'string') {
                                                                    if (func163(data56) > 80) {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/chunks/' +
                                                                            i0 +
                                                                            '/file',
                                                                          schemaPath:
                                                                            '#/properties/chunks/items/properties/file/maxLength',
                                                                          keyword: 'maxLength',
                                                                          params: { limit: 80 },
                                                                          message:
                                                                            'must NOT have more than 80 characters',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    } else {
                                                                      if (func163(data56) < 1) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/chunks/' +
                                                                              i0 +
                                                                              '/file',
                                                                            schemaPath:
                                                                              '#/properties/chunks/items/properties/file/minLength',
                                                                            keyword: 'minLength',
                                                                            params: { limit: 1 },
                                                                            message:
                                                                              'must NOT have fewer than 1 characters',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      } else {
                                                                        if (
                                                                          !pattern3.test(data56)
                                                                        ) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/chunks/' +
                                                                                i0 +
                                                                                '/file',
                                                                              schemaPath:
                                                                                '#/properties/chunks/items/properties/file/pattern',
                                                                              keyword: 'pattern',
                                                                              params: {
                                                                                pattern:
                                                                                  '^ch(?:[0-9]{2}|[AB])-2\\.0\\.0\\.json$',
                                                                              },
                                                                              message:
                                                                                'must match pattern "' +
                                                                                '^ch(?:[0-9]{2}|[AB])-2\\.0\\.0\\.json$' +
                                                                                '"',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                    }
                                                                  } else {
                                                                    validate10.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/chunks/' +
                                                                          i0 +
                                                                          '/file',
                                                                        schemaPath:
                                                                          '#/properties/chunks/items/properties/file/type',
                                                                        keyword: 'type',
                                                                        params: { type: 'string' },
                                                                        message: 'must be string',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  }
                                                                }
                                                                var valid9 = _errs78 === errors;
                                                              } else {
                                                                var valid9 = true;
                                                              }
                                                              if (valid9) {
                                                                if (
                                                                  data52.bytes !== undefined &&
                                                                  func0.call(data52, 'bytes')
                                                                ) {
                                                                  let data57 = data52.bytes;
                                                                  const _errs80 = errors;
                                                                  if (!(
                                                                    typeof data57 == 'number' &&
                                                                    !(data57 % 1) &&
                                                                    !isNaN(data57) &&
                                                                    isFinite(data57)
                                                                  )) {
                                                                    validate10.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/chunks/' +
                                                                          i0 +
                                                                          '/bytes',
                                                                        schemaPath:
                                                                          '#/properties/chunks/items/properties/bytes/type',
                                                                        keyword: 'type',
                                                                        params: { type: 'integer' },
                                                                        message: 'must be integer',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  }
                                                                  if (errors === _errs80) {
                                                                    if (
                                                                      typeof data57 == 'number' &&
                                                                      isFinite(data57)
                                                                    ) {
                                                                      if (
                                                                        data57 > 1048576 ||
                                                                        isNaN(data57)
                                                                      ) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/chunks/' +
                                                                              i0 +
                                                                              '/bytes',
                                                                            schemaPath:
                                                                              '#/properties/chunks/items/properties/bytes/maximum',
                                                                            keyword: 'maximum',
                                                                            params: {
                                                                              comparison: '<=',
                                                                              limit: 1048576,
                                                                            },
                                                                            message:
                                                                              'must be <= 1048576',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      } else {
                                                                        if (
                                                                          data57 < 1 ||
                                                                          isNaN(data57)
                                                                        ) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/chunks/' +
                                                                                i0 +
                                                                                '/bytes',
                                                                              schemaPath:
                                                                                '#/properties/chunks/items/properties/bytes/minimum',
                                                                              keyword: 'minimum',
                                                                              params: {
                                                                                comparison: '>=',
                                                                                limit: 1,
                                                                              },
                                                                              message:
                                                                                'must be >= 1',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                  var valid9 = _errs80 === errors;
                                                                } else {
                                                                  var valid9 = true;
                                                                }
                                                                if (valid9) {
                                                                  if (
                                                                    data52.sha256 !== undefined &&
                                                                    func0.call(data52, 'sha256')
                                                                  ) {
                                                                    let data58 = data52.sha256;
                                                                    const _errs82 = errors;
                                                                    if (errors === _errs82) {
                                                                      if (
                                                                        typeof data58 === 'string'
                                                                      ) {
                                                                        if (
                                                                          !pattern0.test(data58)
                                                                        ) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/chunks/' +
                                                                                i0 +
                                                                                '/sha256',
                                                                              schemaPath:
                                                                                '#/properties/chunks/items/properties/sha256/pattern',
                                                                              keyword: 'pattern',
                                                                              params: {
                                                                                pattern:
                                                                                  '^[a-f0-9]{64}$',
                                                                              },
                                                                              message:
                                                                                'must match pattern "' +
                                                                                '^[a-f0-9]{64}$' +
                                                                                '"',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      } else {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/chunks/' +
                                                                              i0 +
                                                                              '/sha256',
                                                                            schemaPath:
                                                                              '#/properties/chunks/items/properties/sha256/type',
                                                                            keyword: 'type',
                                                                            params: {
                                                                              type: 'string',
                                                                            },
                                                                            message:
                                                                              'must be string',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                    var valid9 = _errs82 === errors;
                                                                  } else {
                                                                    var valid9 = true;
                                                                  }
                                                                  if (valid9) {
                                                                    if (
                                                                      data52.counts !== undefined &&
                                                                      func0.call(data52, 'counts')
                                                                    ) {
                                                                      let data59 = data52.counts;
                                                                      const _errs84 = errors;
                                                                      if (errors === _errs84) {
                                                                        if (
                                                                          data59 &&
                                                                          typeof data59 ==
                                                                            'object' &&
                                                                          !Array.isArray(data59)
                                                                        ) {
                                                                          let missing9;
                                                                          if (
                                                                            ((data59.nodes ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'nodes',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'nodes')) ||
                                                                            ((data59.lessons ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'lessons',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'lessons')) ||
                                                                            ((data59.activities ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'activities',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'activities')) ||
                                                                            ((data59.examples ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'examples',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'examples')) ||
                                                                            ((data59.exercises ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'exercises',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'exercises')) ||
                                                                            ((data59.knowledge ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'knowledge',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'knowledge')) ||
                                                                            ((data59.programs ===
                                                                              undefined ||
                                                                              !func0.call(
                                                                                data59,
                                                                                'programs',
                                                                              )) &&
                                                                              (missing9 =
                                                                                'programs'))
                                                                          ) {
                                                                            validate10.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/chunks/' +
                                                                                  i0 +
                                                                                  '/counts',
                                                                                schemaPath:
                                                                                  '#/properties/chunks/items/properties/counts/required',
                                                                                keyword: 'required',
                                                                                params: {
                                                                                  missingProperty:
                                                                                    missing9,
                                                                                },
                                                                                message:
                                                                                  "must have required property '" +
                                                                                  missing9 +
                                                                                  "'",
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          } else {
                                                                            const _errs86 = errors;
                                                                            for (const key9 of Object.keys(
                                                                              data59,
                                                                            )) {
                                                                              if (!(
                                                                                key9 === 'nodes' ||
                                                                                key9 ===
                                                                                  'lessons' ||
                                                                                key9 ===
                                                                                  'activities' ||
                                                                                key9 ===
                                                                                  'examples' ||
                                                                                key9 ===
                                                                                  'exercises' ||
                                                                                key9 ===
                                                                                  'knowledge' ||
                                                                                key9 === 'programs'
                                                                              )) {
                                                                                validate10.errors =
                                                                                  [
                                                                                    {
                                                                                      instancePath:
                                                                                        instancePath +
                                                                                        '/chunks/' +
                                                                                        i0 +
                                                                                        '/counts',
                                                                                      schemaPath:
                                                                                        '#/properties/chunks/items/properties/counts/additionalProperties',
                                                                                      keyword:
                                                                                        'additionalProperties',
                                                                                      params: {
                                                                                        additionalProperty:
                                                                                          key9,
                                                                                      },
                                                                                      message:
                                                                                        'must NOT have additional properties',
                                                                                    },
                                                                                  ];
                                                                                return false;
                                                                                break;
                                                                              }
                                                                            }
                                                                            if (
                                                                              _errs86 === errors
                                                                            ) {
                                                                              if (
                                                                                data59.nodes !==
                                                                                  undefined &&
                                                                                func0.call(
                                                                                  data59,
                                                                                  'nodes',
                                                                                )
                                                                              ) {
                                                                                let data60 =
                                                                                  data59.nodes;
                                                                                const _errs87 =
                                                                                  errors;
                                                                                if (!(
                                                                                  typeof data60 ==
                                                                                    'number' &&
                                                                                  !(data60 % 1) &&
                                                                                  !isNaN(data60) &&
                                                                                  isFinite(data60)
                                                                                )) {
                                                                                  validate10.errors =
                                                                                    [
                                                                                      {
                                                                                        instancePath:
                                                                                          instancePath +
                                                                                          '/chunks/' +
                                                                                          i0 +
                                                                                          '/counts/nodes',
                                                                                        schemaPath:
                                                                                          '#/properties/chunks/items/properties/counts/properties/nodes/type',
                                                                                        keyword:
                                                                                          'type',
                                                                                        params: {
                                                                                          type: 'integer',
                                                                                        },
                                                                                        message:
                                                                                          'must be integer',
                                                                                      },
                                                                                    ];
                                                                                  return false;
                                                                                }
                                                                                if (
                                                                                  errors === _errs87
                                                                                ) {
                                                                                  if (
                                                                                    typeof data60 ==
                                                                                      'number' &&
                                                                                    isFinite(data60)
                                                                                  ) {
                                                                                    if (
                                                                                      data60 >
                                                                                        900 ||
                                                                                      isNaN(data60)
                                                                                    ) {
                                                                                      validate10.errors =
                                                                                        [
                                                                                          {
                                                                                            instancePath:
                                                                                              instancePath +
                                                                                              '/chunks/' +
                                                                                              i0 +
                                                                                              '/counts/nodes',
                                                                                            schemaPath:
                                                                                              '#/properties/chunks/items/properties/counts/properties/nodes/maximum',
                                                                                            keyword:
                                                                                              'maximum',
                                                                                            params:
                                                                                              {
                                                                                                comparison:
                                                                                                  '<=',
                                                                                                limit: 900,
                                                                                              },
                                                                                            message:
                                                                                              'must be <= 900',
                                                                                          },
                                                                                        ];
                                                                                      return false;
                                                                                    } else {
                                                                                      if (
                                                                                        data60 <
                                                                                          0 ||
                                                                                        isNaN(
                                                                                          data60,
                                                                                        )
                                                                                      ) {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/chunks/' +
                                                                                                i0 +
                                                                                                '/counts/nodes',
                                                                                              schemaPath:
                                                                                                '#/properties/chunks/items/properties/counts/properties/nodes/minimum',
                                                                                              keyword:
                                                                                                'minimum',
                                                                                              params:
                                                                                                {
                                                                                                  comparison:
                                                                                                    '>=',
                                                                                                  limit: 0,
                                                                                                },
                                                                                              message:
                                                                                                'must be >= 0',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                                var valid10 =
                                                                                  _errs87 ===
                                                                                  errors;
                                                                              } else {
                                                                                var valid10 = true;
                                                                              }
                                                                              if (valid10) {
                                                                                if (
                                                                                  data59.lessons !==
                                                                                    undefined &&
                                                                                  func0.call(
                                                                                    data59,
                                                                                    'lessons',
                                                                                  )
                                                                                ) {
                                                                                  let data61 =
                                                                                    data59.lessons;
                                                                                  const _errs89 =
                                                                                    errors;
                                                                                  if (!(
                                                                                    typeof data61 ==
                                                                                      'number' &&
                                                                                    !(data61 % 1) &&
                                                                                    !isNaN(
                                                                                      data61,
                                                                                    ) &&
                                                                                    isFinite(data61)
                                                                                  )) {
                                                                                    validate10.errors =
                                                                                      [
                                                                                        {
                                                                                          instancePath:
                                                                                            instancePath +
                                                                                            '/chunks/' +
                                                                                            i0 +
                                                                                            '/counts/lessons',
                                                                                          schemaPath:
                                                                                            '#/properties/chunks/items/properties/counts/properties/lessons/type',
                                                                                          keyword:
                                                                                            'type',
                                                                                          params: {
                                                                                            type: 'integer',
                                                                                          },
                                                                                          message:
                                                                                            'must be integer',
                                                                                        },
                                                                                      ];
                                                                                    return false;
                                                                                  }
                                                                                  if (
                                                                                    errors ===
                                                                                    _errs89
                                                                                  ) {
                                                                                    if (
                                                                                      typeof data61 ==
                                                                                        'number' &&
                                                                                      isFinite(
                                                                                        data61,
                                                                                      )
                                                                                    ) {
                                                                                      if (
                                                                                        data61 >
                                                                                          900 ||
                                                                                        isNaN(
                                                                                          data61,
                                                                                        )
                                                                                      ) {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/chunks/' +
                                                                                                i0 +
                                                                                                '/counts/lessons',
                                                                                              schemaPath:
                                                                                                '#/properties/chunks/items/properties/counts/properties/lessons/maximum',
                                                                                              keyword:
                                                                                                'maximum',
                                                                                              params:
                                                                                                {
                                                                                                  comparison:
                                                                                                    '<=',
                                                                                                  limit: 900,
                                                                                                },
                                                                                              message:
                                                                                                'must be <= 900',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      } else {
                                                                                        if (
                                                                                          data61 <
                                                                                            0 ||
                                                                                          isNaN(
                                                                                            data61,
                                                                                          )
                                                                                        ) {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/counts/lessons',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/counts/properties/lessons/minimum',
                                                                                                keyword:
                                                                                                  'minimum',
                                                                                                params:
                                                                                                  {
                                                                                                    comparison:
                                                                                                      '>=',
                                                                                                    limit: 0,
                                                                                                  },
                                                                                                message:
                                                                                                  'must be >= 0',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                  var valid10 =
                                                                                    _errs89 ===
                                                                                    errors;
                                                                                } else {
                                                                                  var valid10 = true;
                                                                                }
                                                                                if (valid10) {
                                                                                  if (
                                                                                    data59.activities !==
                                                                                      undefined &&
                                                                                    func0.call(
                                                                                      data59,
                                                                                      'activities',
                                                                                    )
                                                                                  ) {
                                                                                    let data62 =
                                                                                      data59.activities;
                                                                                    const _errs91 =
                                                                                      errors;
                                                                                    if (!(
                                                                                      typeof data62 ==
                                                                                        'number' &&
                                                                                      !(
                                                                                        data62 % 1
                                                                                      ) &&
                                                                                      !isNaN(
                                                                                        data62,
                                                                                      ) &&
                                                                                      isFinite(
                                                                                        data62,
                                                                                      )
                                                                                    )) {
                                                                                      validate10.errors =
                                                                                        [
                                                                                          {
                                                                                            instancePath:
                                                                                              instancePath +
                                                                                              '/chunks/' +
                                                                                              i0 +
                                                                                              '/counts/activities',
                                                                                            schemaPath:
                                                                                              '#/properties/chunks/items/properties/counts/properties/activities/type',
                                                                                            keyword:
                                                                                              'type',
                                                                                            params:
                                                                                              {
                                                                                                type: 'integer',
                                                                                              },
                                                                                            message:
                                                                                              'must be integer',
                                                                                          },
                                                                                        ];
                                                                                      return false;
                                                                                    }
                                                                                    if (
                                                                                      errors ===
                                                                                      _errs91
                                                                                    ) {
                                                                                      if (
                                                                                        typeof data62 ==
                                                                                          'number' &&
                                                                                        isFinite(
                                                                                          data62,
                                                                                        )
                                                                                      ) {
                                                                                        if (
                                                                                          data62 >
                                                                                            900 ||
                                                                                          isNaN(
                                                                                            data62,
                                                                                          )
                                                                                        ) {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/counts/activities',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/counts/properties/activities/maximum',
                                                                                                keyword:
                                                                                                  'maximum',
                                                                                                params:
                                                                                                  {
                                                                                                    comparison:
                                                                                                      '<=',
                                                                                                    limit: 900,
                                                                                                  },
                                                                                                message:
                                                                                                  'must be <= 900',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        } else {
                                                                                          if (
                                                                                            data62 <
                                                                                              0 ||
                                                                                            isNaN(
                                                                                              data62,
                                                                                            )
                                                                                          ) {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/counts/activities',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/counts/properties/activities/minimum',
                                                                                                  keyword:
                                                                                                    'minimum',
                                                                                                  params:
                                                                                                    {
                                                                                                      comparison:
                                                                                                        '>=',
                                                                                                      limit: 0,
                                                                                                    },
                                                                                                  message:
                                                                                                    'must be >= 0',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                    var valid10 =
                                                                                      _errs91 ===
                                                                                      errors;
                                                                                  } else {
                                                                                    var valid10 = true;
                                                                                  }
                                                                                  if (valid10) {
                                                                                    if (
                                                                                      data59.examples !==
                                                                                        undefined &&
                                                                                      func0.call(
                                                                                        data59,
                                                                                        'examples',
                                                                                      )
                                                                                    ) {
                                                                                      let data63 =
                                                                                        data59.examples;
                                                                                      const _errs93 =
                                                                                        errors;
                                                                                      if (!(
                                                                                        typeof data63 ==
                                                                                          'number' &&
                                                                                        !(
                                                                                          data63 % 1
                                                                                        ) &&
                                                                                        !isNaN(
                                                                                          data63,
                                                                                        ) &&
                                                                                        isFinite(
                                                                                          data63,
                                                                                        )
                                                                                      )) {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/chunks/' +
                                                                                                i0 +
                                                                                                '/counts/examples',
                                                                                              schemaPath:
                                                                                                '#/properties/chunks/items/properties/counts/properties/examples/type',
                                                                                              keyword:
                                                                                                'type',
                                                                                              params:
                                                                                                {
                                                                                                  type: 'integer',
                                                                                                },
                                                                                              message:
                                                                                                'must be integer',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      }
                                                                                      if (
                                                                                        errors ===
                                                                                        _errs93
                                                                                      ) {
                                                                                        if (
                                                                                          typeof data63 ==
                                                                                            'number' &&
                                                                                          isFinite(
                                                                                            data63,
                                                                                          )
                                                                                        ) {
                                                                                          if (
                                                                                            data63 >
                                                                                              900 ||
                                                                                            isNaN(
                                                                                              data63,
                                                                                            )
                                                                                          ) {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/counts/examples',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/counts/properties/examples/maximum',
                                                                                                  keyword:
                                                                                                    'maximum',
                                                                                                  params:
                                                                                                    {
                                                                                                      comparison:
                                                                                                        '<=',
                                                                                                      limit: 900,
                                                                                                    },
                                                                                                  message:
                                                                                                    'must be <= 900',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          } else {
                                                                                            if (
                                                                                              data63 <
                                                                                                0 ||
                                                                                              isNaN(
                                                                                                data63,
                                                                                              )
                                                                                            ) {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/counts/examples',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/counts/properties/examples/minimum',
                                                                                                    keyword:
                                                                                                      'minimum',
                                                                                                    params:
                                                                                                      {
                                                                                                        comparison:
                                                                                                          '>=',
                                                                                                        limit: 0,
                                                                                                      },
                                                                                                    message:
                                                                                                      'must be >= 0',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                      var valid10 =
                                                                                        _errs93 ===
                                                                                        errors;
                                                                                    } else {
                                                                                      var valid10 = true;
                                                                                    }
                                                                                    if (valid10) {
                                                                                      if (
                                                                                        data59.exercises !==
                                                                                          undefined &&
                                                                                        func0.call(
                                                                                          data59,
                                                                                          'exercises',
                                                                                        )
                                                                                      ) {
                                                                                        let data64 =
                                                                                          data59.exercises;
                                                                                        const _errs95 =
                                                                                          errors;
                                                                                        if (!(
                                                                                          typeof data64 ==
                                                                                            'number' &&
                                                                                          !(
                                                                                            data64 %
                                                                                            1
                                                                                          ) &&
                                                                                          !isNaN(
                                                                                            data64,
                                                                                          ) &&
                                                                                          isFinite(
                                                                                            data64,
                                                                                          )
                                                                                        )) {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/counts/exercises',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/counts/properties/exercises/type',
                                                                                                keyword:
                                                                                                  'type',
                                                                                                params:
                                                                                                  {
                                                                                                    type: 'integer',
                                                                                                  },
                                                                                                message:
                                                                                                  'must be integer',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        }
                                                                                        if (
                                                                                          errors ===
                                                                                          _errs95
                                                                                        ) {
                                                                                          if (
                                                                                            typeof data64 ==
                                                                                              'number' &&
                                                                                            isFinite(
                                                                                              data64,
                                                                                            )
                                                                                          ) {
                                                                                            if (
                                                                                              data64 >
                                                                                                900 ||
                                                                                              isNaN(
                                                                                                data64,
                                                                                              )
                                                                                            ) {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/counts/exercises',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/counts/properties/exercises/maximum',
                                                                                                    keyword:
                                                                                                      'maximum',
                                                                                                    params:
                                                                                                      {
                                                                                                        comparison:
                                                                                                          '<=',
                                                                                                        limit: 900,
                                                                                                      },
                                                                                                    message:
                                                                                                      'must be <= 900',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            } else {
                                                                                              if (
                                                                                                data64 <
                                                                                                  0 ||
                                                                                                isNaN(
                                                                                                  data64,
                                                                                                )
                                                                                              ) {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/counts/exercises',
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/counts/properties/exercises/minimum',
                                                                                                      keyword:
                                                                                                        'minimum',
                                                                                                      params:
                                                                                                        {
                                                                                                          comparison:
                                                                                                            '>=',
                                                                                                          limit: 0,
                                                                                                        },
                                                                                                      message:
                                                                                                        'must be >= 0',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                        var valid10 =
                                                                                          _errs95 ===
                                                                                          errors;
                                                                                      } else {
                                                                                        var valid10 = true;
                                                                                      }
                                                                                      if (valid10) {
                                                                                        if (
                                                                                          data59.knowledge !==
                                                                                            undefined &&
                                                                                          func0.call(
                                                                                            data59,
                                                                                            'knowledge',
                                                                                          )
                                                                                        ) {
                                                                                          let data65 =
                                                                                            data59.knowledge;
                                                                                          const _errs97 =
                                                                                            errors;
                                                                                          if (!(
                                                                                            typeof data65 ==
                                                                                              'number' &&
                                                                                            !(
                                                                                              data65 %
                                                                                              1
                                                                                            ) &&
                                                                                            !isNaN(
                                                                                              data65,
                                                                                            ) &&
                                                                                            isFinite(
                                                                                              data65,
                                                                                            )
                                                                                          )) {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/counts/knowledge',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/counts/properties/knowledge/type',
                                                                                                  keyword:
                                                                                                    'type',
                                                                                                  params:
                                                                                                    {
                                                                                                      type: 'integer',
                                                                                                    },
                                                                                                  message:
                                                                                                    'must be integer',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          }
                                                                                          if (
                                                                                            errors ===
                                                                                            _errs97
                                                                                          ) {
                                                                                            if (
                                                                                              typeof data65 ==
                                                                                                'number' &&
                                                                                              isFinite(
                                                                                                data65,
                                                                                              )
                                                                                            ) {
                                                                                              if (
                                                                                                data65 >
                                                                                                  900 ||
                                                                                                isNaN(
                                                                                                  data65,
                                                                                                )
                                                                                              ) {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/counts/knowledge',
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/counts/properties/knowledge/maximum',
                                                                                                      keyword:
                                                                                                        'maximum',
                                                                                                      params:
                                                                                                        {
                                                                                                          comparison:
                                                                                                            '<=',
                                                                                                          limit: 900,
                                                                                                        },
                                                                                                      message:
                                                                                                        'must be <= 900',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              } else {
                                                                                                if (
                                                                                                  data65 <
                                                                                                    0 ||
                                                                                                  isNaN(
                                                                                                    data65,
                                                                                                  )
                                                                                                ) {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/counts/knowledge',
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/counts/properties/knowledge/minimum',
                                                                                                        keyword:
                                                                                                          'minimum',
                                                                                                        params:
                                                                                                          {
                                                                                                            comparison:
                                                                                                              '>=',
                                                                                                            limit: 0,
                                                                                                          },
                                                                                                        message:
                                                                                                          'must be >= 0',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                          var valid10 =
                                                                                            _errs97 ===
                                                                                            errors;
                                                                                        } else {
                                                                                          var valid10 = true;
                                                                                        }
                                                                                        if (
                                                                                          valid10
                                                                                        ) {
                                                                                          if (
                                                                                            data59.programs !==
                                                                                              undefined &&
                                                                                            func0.call(
                                                                                              data59,
                                                                                              'programs',
                                                                                            )
                                                                                          ) {
                                                                                            let data66 =
                                                                                              data59.programs;
                                                                                            const _errs99 =
                                                                                              errors;
                                                                                            if (!(
                                                                                              typeof data66 ==
                                                                                                'number' &&
                                                                                              !(
                                                                                                data66 %
                                                                                                1
                                                                                              ) &&
                                                                                              !isNaN(
                                                                                                data66,
                                                                                              ) &&
                                                                                              isFinite(
                                                                                                data66,
                                                                                              )
                                                                                            )) {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/counts/programs',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/counts/properties/programs/type',
                                                                                                    keyword:
                                                                                                      'type',
                                                                                                    params:
                                                                                                      {
                                                                                                        type: 'integer',
                                                                                                      },
                                                                                                    message:
                                                                                                      'must be integer',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            }
                                                                                            if (
                                                                                              errors ===
                                                                                              _errs99
                                                                                            ) {
                                                                                              if (
                                                                                                typeof data66 ==
                                                                                                  'number' &&
                                                                                                isFinite(
                                                                                                  data66,
                                                                                                )
                                                                                              ) {
                                                                                                if (
                                                                                                  data66 >
                                                                                                    900 ||
                                                                                                  isNaN(
                                                                                                    data66,
                                                                                                  )
                                                                                                ) {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/counts/programs',
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/counts/properties/programs/maximum',
                                                                                                        keyword:
                                                                                                          'maximum',
                                                                                                        params:
                                                                                                          {
                                                                                                            comparison:
                                                                                                              '<=',
                                                                                                            limit: 900,
                                                                                                          },
                                                                                                        message:
                                                                                                          'must be <= 900',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                } else {
                                                                                                  if (
                                                                                                    data66 <
                                                                                                      0 ||
                                                                                                    isNaN(
                                                                                                      data66,
                                                                                                    )
                                                                                                  ) {
                                                                                                    validate10.errors =
                                                                                                      [
                                                                                                        {
                                                                                                          instancePath:
                                                                                                            instancePath +
                                                                                                            '/chunks/' +
                                                                                                            i0 +
                                                                                                            '/counts/programs',
                                                                                                          schemaPath:
                                                                                                            '#/properties/chunks/items/properties/counts/properties/programs/minimum',
                                                                                                          keyword:
                                                                                                            'minimum',
                                                                                                          params:
                                                                                                            {
                                                                                                              comparison:
                                                                                                                '>=',
                                                                                                              limit: 0,
                                                                                                            },
                                                                                                          message:
                                                                                                            'must be >= 0',
                                                                                                        },
                                                                                                      ];
                                                                                                    return false;
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                            var valid10 =
                                                                                              _errs99 ===
                                                                                              errors;
                                                                                          } else {
                                                                                            var valid10 = true;
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        } else {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/chunks/' +
                                                                                i0 +
                                                                                '/counts',
                                                                              schemaPath:
                                                                                '#/properties/chunks/items/properties/counts/type',
                                                                              keyword: 'type',
                                                                              params: {
                                                                                type: 'object',
                                                                              },
                                                                              message:
                                                                                'must be object',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                      var valid9 =
                                                                        _errs84 === errors;
                                                                    } else {
                                                                      var valid9 = true;
                                                                    }
                                                                    if (valid9) {
                                                                      if (
                                                                        data52.entityIds !==
                                                                          undefined &&
                                                                        func0.call(
                                                                          data52,
                                                                          'entityIds',
                                                                        )
                                                                      ) {
                                                                        let data67 =
                                                                          data52.entityIds;
                                                                        const _errs101 = errors;
                                                                        if (errors === _errs101) {
                                                                          if (
                                                                            data67 &&
                                                                            typeof data67 ==
                                                                              'object' &&
                                                                            !Array.isArray(data67)
                                                                          ) {
                                                                            let missing10;
                                                                            if (
                                                                              ((data67.lessons ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'lessons',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'lessons')) ||
                                                                              ((data67.activities ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'activities',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'activities')) ||
                                                                              ((data67.examples ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'examples',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'examples')) ||
                                                                              ((data67.exercises ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'exercises',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'exercises')) ||
                                                                              ((data67.knowledge ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'knowledge',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'knowledge')) ||
                                                                              ((data67.programs ===
                                                                                undefined ||
                                                                                !func0.call(
                                                                                  data67,
                                                                                  'programs',
                                                                                )) &&
                                                                                (missing10 =
                                                                                  'programs'))
                                                                            ) {
                                                                              validate10.errors = [
                                                                                {
                                                                                  instancePath:
                                                                                    instancePath +
                                                                                    '/chunks/' +
                                                                                    i0 +
                                                                                    '/entityIds',
                                                                                  schemaPath:
                                                                                    '#/properties/chunks/items/properties/entityIds/required',
                                                                                  keyword:
                                                                                    'required',
                                                                                  params: {
                                                                                    missingProperty:
                                                                                      missing10,
                                                                                  },
                                                                                  message:
                                                                                    "must have required property '" +
                                                                                    missing10 +
                                                                                    "'",
                                                                                },
                                                                              ];
                                                                              return false;
                                                                            } else {
                                                                              const _errs103 =
                                                                                errors;
                                                                              for (const key10 of Object.keys(
                                                                                data67,
                                                                              )) {
                                                                                if (!(
                                                                                  key10 ===
                                                                                    'lessons' ||
                                                                                  key10 ===
                                                                                    'activities' ||
                                                                                  key10 ===
                                                                                    'examples' ||
                                                                                  key10 ===
                                                                                    'exercises' ||
                                                                                  key10 ===
                                                                                    'knowledge' ||
                                                                                  key10 ===
                                                                                    'programs'
                                                                                )) {
                                                                                  validate10.errors =
                                                                                    [
                                                                                      {
                                                                                        instancePath:
                                                                                          instancePath +
                                                                                          '/chunks/' +
                                                                                          i0 +
                                                                                          '/entityIds',
                                                                                        schemaPath:
                                                                                          '#/properties/chunks/items/properties/entityIds/additionalProperties',
                                                                                        keyword:
                                                                                          'additionalProperties',
                                                                                        params: {
                                                                                          additionalProperty:
                                                                                            key10,
                                                                                        },
                                                                                        message:
                                                                                          'must NOT have additional properties',
                                                                                      },
                                                                                    ];
                                                                                  return false;
                                                                                  break;
                                                                                }
                                                                              }
                                                                              if (
                                                                                _errs103 === errors
                                                                              ) {
                                                                                if (
                                                                                  data67.lessons !==
                                                                                    undefined &&
                                                                                  func0.call(
                                                                                    data67,
                                                                                    'lessons',
                                                                                  )
                                                                                ) {
                                                                                  let data68 =
                                                                                    data67.lessons;
                                                                                  const _errs104 =
                                                                                    errors;
                                                                                  if (
                                                                                    errors ===
                                                                                    _errs104
                                                                                  ) {
                                                                                    if (
                                                                                      Array.isArray(
                                                                                        data68,
                                                                                      )
                                                                                    ) {
                                                                                      if (
                                                                                        data68.length >
                                                                                        900
                                                                                      ) {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/chunks/' +
                                                                                                i0 +
                                                                                                '/entityIds/lessons',
                                                                                              schemaPath:
                                                                                                '#/properties/chunks/items/properties/entityIds/properties/lessons/maxItems',
                                                                                              keyword:
                                                                                                'maxItems',
                                                                                              params:
                                                                                                {
                                                                                                  limit: 900,
                                                                                                },
                                                                                              message:
                                                                                                'must NOT have more than 900 items',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      } else {
                                                                                        if (
                                                                                          data68.length <
                                                                                          0
                                                                                        ) {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/entityIds/lessons',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/lessons/minItems',
                                                                                                keyword:
                                                                                                  'minItems',
                                                                                                params:
                                                                                                  {
                                                                                                    limit: 0,
                                                                                                  },
                                                                                                message:
                                                                                                  'must NOT have fewer than 0 items',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        } else {
                                                                                          var valid12 = true;
                                                                                          const len1 =
                                                                                            data68.length;
                                                                                          for (
                                                                                            let i1 = 0;
                                                                                            i1 <
                                                                                            len1;
                                                                                            i1++
                                                                                          ) {
                                                                                            let data69 =
                                                                                              data68[
                                                                                                i1
                                                                                              ];
                                                                                            const _errs106 =
                                                                                              errors;
                                                                                            if (
                                                                                              errors ===
                                                                                              _errs106
                                                                                            ) {
                                                                                              if (
                                                                                                typeof data69 ===
                                                                                                'string'
                                                                                              ) {
                                                                                                if (
                                                                                                  func163(
                                                                                                    data69,
                                                                                                  ) >
                                                                                                  180
                                                                                                ) {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/entityIds/lessons/' +
                                                                                                          i1,
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/entityIds/properties/lessons/items/maxLength',
                                                                                                        keyword:
                                                                                                          'maxLength',
                                                                                                        params:
                                                                                                          {
                                                                                                            limit: 180,
                                                                                                          },
                                                                                                        message:
                                                                                                          'must NOT have more than 180 characters',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                } else {
                                                                                                  if (
                                                                                                    func163(
                                                                                                      data69,
                                                                                                    ) <
                                                                                                    1
                                                                                                  ) {
                                                                                                    validate10.errors =
                                                                                                      [
                                                                                                        {
                                                                                                          instancePath:
                                                                                                            instancePath +
                                                                                                            '/chunks/' +
                                                                                                            i0 +
                                                                                                            '/entityIds/lessons/' +
                                                                                                            i1,
                                                                                                          schemaPath:
                                                                                                            '#/properties/chunks/items/properties/entityIds/properties/lessons/items/minLength',
                                                                                                          keyword:
                                                                                                            'minLength',
                                                                                                          params:
                                                                                                            {
                                                                                                              limit: 1,
                                                                                                            },
                                                                                                          message:
                                                                                                            'must NOT have fewer than 1 characters',
                                                                                                        },
                                                                                                      ];
                                                                                                    return false;
                                                                                                  } else {
                                                                                                    if (
                                                                                                      !pattern5.test(
                                                                                                        data69,
                                                                                                      )
                                                                                                    ) {
                                                                                                      validate10.errors =
                                                                                                        [
                                                                                                          {
                                                                                                            instancePath:
                                                                                                              instancePath +
                                                                                                              '/chunks/' +
                                                                                                              i0 +
                                                                                                              '/entityIds/lessons/' +
                                                                                                              i1,
                                                                                                            schemaPath:
                                                                                                              '#/properties/chunks/items/properties/entityIds/properties/lessons/items/pattern',
                                                                                                            keyword:
                                                                                                              'pattern',
                                                                                                            params:
                                                                                                              {
                                                                                                                pattern:
                                                                                                                  '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                              },
                                                                                                            message:
                                                                                                              'must match pattern "' +
                                                                                                              '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                              '"',
                                                                                                          },
                                                                                                        ];
                                                                                                      return false;
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              } else {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/entityIds/lessons/' +
                                                                                                        i1,
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/entityIds/properties/lessons/items/type',
                                                                                                      keyword:
                                                                                                        'type',
                                                                                                      params:
                                                                                                        {
                                                                                                          type: 'string',
                                                                                                        },
                                                                                                      message:
                                                                                                        'must be string',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              }
                                                                                            }
                                                                                            var valid12 =
                                                                                              _errs106 ===
                                                                                              errors;
                                                                                            if (
                                                                                              !valid12
                                                                                            ) {
                                                                                              break;
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    } else {
                                                                                      validate10.errors =
                                                                                        [
                                                                                          {
                                                                                            instancePath:
                                                                                              instancePath +
                                                                                              '/chunks/' +
                                                                                              i0 +
                                                                                              '/entityIds/lessons',
                                                                                            schemaPath:
                                                                                              '#/properties/chunks/items/properties/entityIds/properties/lessons/type',
                                                                                            keyword:
                                                                                              'type',
                                                                                            params:
                                                                                              {
                                                                                                type: 'array',
                                                                                              },
                                                                                            message:
                                                                                              'must be array',
                                                                                          },
                                                                                        ];
                                                                                      return false;
                                                                                    }
                                                                                  }
                                                                                  var valid11 =
                                                                                    _errs104 ===
                                                                                    errors;
                                                                                } else {
                                                                                  var valid11 = true;
                                                                                }
                                                                                if (valid11) {
                                                                                  if (
                                                                                    data67.activities !==
                                                                                      undefined &&
                                                                                    func0.call(
                                                                                      data67,
                                                                                      'activities',
                                                                                    )
                                                                                  ) {
                                                                                    let data70 =
                                                                                      data67.activities;
                                                                                    const _errs108 =
                                                                                      errors;
                                                                                    if (
                                                                                      errors ===
                                                                                      _errs108
                                                                                    ) {
                                                                                      if (
                                                                                        Array.isArray(
                                                                                          data70,
                                                                                        )
                                                                                      ) {
                                                                                        if (
                                                                                          data70.length >
                                                                                          900
                                                                                        ) {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/entityIds/activities',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/activities/maxItems',
                                                                                                keyword:
                                                                                                  'maxItems',
                                                                                                params:
                                                                                                  {
                                                                                                    limit: 900,
                                                                                                  },
                                                                                                message:
                                                                                                  'must NOT have more than 900 items',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        } else {
                                                                                          if (
                                                                                            data70.length <
                                                                                            0
                                                                                          ) {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/entityIds/activities',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/activities/minItems',
                                                                                                  keyword:
                                                                                                    'minItems',
                                                                                                  params:
                                                                                                    {
                                                                                                      limit: 0,
                                                                                                    },
                                                                                                  message:
                                                                                                    'must NOT have fewer than 0 items',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          } else {
                                                                                            var valid13 = true;
                                                                                            const len2 =
                                                                                              data70.length;
                                                                                            for (
                                                                                              let i2 = 0;
                                                                                              i2 <
                                                                                              len2;
                                                                                              i2++
                                                                                            ) {
                                                                                              let data71 =
                                                                                                data70[
                                                                                                  i2
                                                                                                ];
                                                                                              const _errs110 =
                                                                                                errors;
                                                                                              if (
                                                                                                errors ===
                                                                                                _errs110
                                                                                              ) {
                                                                                                if (
                                                                                                  typeof data71 ===
                                                                                                  'string'
                                                                                                ) {
                                                                                                  if (
                                                                                                    func163(
                                                                                                      data71,
                                                                                                    ) >
                                                                                                    180
                                                                                                  ) {
                                                                                                    validate10.errors =
                                                                                                      [
                                                                                                        {
                                                                                                          instancePath:
                                                                                                            instancePath +
                                                                                                            '/chunks/' +
                                                                                                            i0 +
                                                                                                            '/entityIds/activities/' +
                                                                                                            i2,
                                                                                                          schemaPath:
                                                                                                            '#/properties/chunks/items/properties/entityIds/properties/activities/items/maxLength',
                                                                                                          keyword:
                                                                                                            'maxLength',
                                                                                                          params:
                                                                                                            {
                                                                                                              limit: 180,
                                                                                                            },
                                                                                                          message:
                                                                                                            'must NOT have more than 180 characters',
                                                                                                        },
                                                                                                      ];
                                                                                                    return false;
                                                                                                  } else {
                                                                                                    if (
                                                                                                      func163(
                                                                                                        data71,
                                                                                                      ) <
                                                                                                      1
                                                                                                    ) {
                                                                                                      validate10.errors =
                                                                                                        [
                                                                                                          {
                                                                                                            instancePath:
                                                                                                              instancePath +
                                                                                                              '/chunks/' +
                                                                                                              i0 +
                                                                                                              '/entityIds/activities/' +
                                                                                                              i2,
                                                                                                            schemaPath:
                                                                                                              '#/properties/chunks/items/properties/entityIds/properties/activities/items/minLength',
                                                                                                            keyword:
                                                                                                              'minLength',
                                                                                                            params:
                                                                                                              {
                                                                                                                limit: 1,
                                                                                                              },
                                                                                                            message:
                                                                                                              'must NOT have fewer than 1 characters',
                                                                                                          },
                                                                                                        ];
                                                                                                      return false;
                                                                                                    } else {
                                                                                                      if (
                                                                                                        !pattern5.test(
                                                                                                          data71,
                                                                                                        )
                                                                                                      ) {
                                                                                                        validate10.errors =
                                                                                                          [
                                                                                                            {
                                                                                                              instancePath:
                                                                                                                instancePath +
                                                                                                                '/chunks/' +
                                                                                                                i0 +
                                                                                                                '/entityIds/activities/' +
                                                                                                                i2,
                                                                                                              schemaPath:
                                                                                                                '#/properties/chunks/items/properties/entityIds/properties/activities/items/pattern',
                                                                                                              keyword:
                                                                                                                'pattern',
                                                                                                              params:
                                                                                                                {
                                                                                                                  pattern:
                                                                                                                    '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                                },
                                                                                                              message:
                                                                                                                'must match pattern "' +
                                                                                                                '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                                '"',
                                                                                                            },
                                                                                                          ];
                                                                                                        return false;
                                                                                                      }
                                                                                                    }
                                                                                                  }
                                                                                                } else {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/entityIds/activities/' +
                                                                                                          i2,
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/entityIds/properties/activities/items/type',
                                                                                                        keyword:
                                                                                                          'type',
                                                                                                        params:
                                                                                                          {
                                                                                                            type: 'string',
                                                                                                          },
                                                                                                        message:
                                                                                                          'must be string',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                }
                                                                                              }
                                                                                              var valid13 =
                                                                                                _errs110 ===
                                                                                                errors;
                                                                                              if (
                                                                                                !valid13
                                                                                              ) {
                                                                                                break;
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      } else {
                                                                                        validate10.errors =
                                                                                          [
                                                                                            {
                                                                                              instancePath:
                                                                                                instancePath +
                                                                                                '/chunks/' +
                                                                                                i0 +
                                                                                                '/entityIds/activities',
                                                                                              schemaPath:
                                                                                                '#/properties/chunks/items/properties/entityIds/properties/activities/type',
                                                                                              keyword:
                                                                                                'type',
                                                                                              params:
                                                                                                {
                                                                                                  type: 'array',
                                                                                                },
                                                                                              message:
                                                                                                'must be array',
                                                                                            },
                                                                                          ];
                                                                                        return false;
                                                                                      }
                                                                                    }
                                                                                    var valid11 =
                                                                                      _errs108 ===
                                                                                      errors;
                                                                                  } else {
                                                                                    var valid11 = true;
                                                                                  }
                                                                                  if (valid11) {
                                                                                    if (
                                                                                      data67.examples !==
                                                                                        undefined &&
                                                                                      func0.call(
                                                                                        data67,
                                                                                        'examples',
                                                                                      )
                                                                                    ) {
                                                                                      let data72 =
                                                                                        data67.examples;
                                                                                      const _errs112 =
                                                                                        errors;
                                                                                      if (
                                                                                        errors ===
                                                                                        _errs112
                                                                                      ) {
                                                                                        if (
                                                                                          Array.isArray(
                                                                                            data72,
                                                                                          )
                                                                                        ) {
                                                                                          if (
                                                                                            data72.length >
                                                                                            900
                                                                                          ) {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/entityIds/examples',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/examples/maxItems',
                                                                                                  keyword:
                                                                                                    'maxItems',
                                                                                                  params:
                                                                                                    {
                                                                                                      limit: 900,
                                                                                                    },
                                                                                                  message:
                                                                                                    'must NOT have more than 900 items',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          } else {
                                                                                            if (
                                                                                              data72.length <
                                                                                              0
                                                                                            ) {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/entityIds/examples',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/entityIds/properties/examples/minItems',
                                                                                                    keyword:
                                                                                                      'minItems',
                                                                                                    params:
                                                                                                      {
                                                                                                        limit: 0,
                                                                                                      },
                                                                                                    message:
                                                                                                      'must NOT have fewer than 0 items',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            } else {
                                                                                              var valid14 = true;
                                                                                              const len3 =
                                                                                                data72.length;
                                                                                              for (
                                                                                                let i3 = 0;
                                                                                                i3 <
                                                                                                len3;
                                                                                                i3++
                                                                                              ) {
                                                                                                let data73 =
                                                                                                  data72[
                                                                                                    i3
                                                                                                  ];
                                                                                                const _errs114 =
                                                                                                  errors;
                                                                                                if (
                                                                                                  errors ===
                                                                                                  _errs114
                                                                                                ) {
                                                                                                  if (
                                                                                                    typeof data73 ===
                                                                                                    'string'
                                                                                                  ) {
                                                                                                    if (
                                                                                                      func163(
                                                                                                        data73,
                                                                                                      ) >
                                                                                                      180
                                                                                                    ) {
                                                                                                      validate10.errors =
                                                                                                        [
                                                                                                          {
                                                                                                            instancePath:
                                                                                                              instancePath +
                                                                                                              '/chunks/' +
                                                                                                              i0 +
                                                                                                              '/entityIds/examples/' +
                                                                                                              i3,
                                                                                                            schemaPath:
                                                                                                              '#/properties/chunks/items/properties/entityIds/properties/examples/items/maxLength',
                                                                                                            keyword:
                                                                                                              'maxLength',
                                                                                                            params:
                                                                                                              {
                                                                                                                limit: 180,
                                                                                                              },
                                                                                                            message:
                                                                                                              'must NOT have more than 180 characters',
                                                                                                          },
                                                                                                        ];
                                                                                                      return false;
                                                                                                    } else {
                                                                                                      if (
                                                                                                        func163(
                                                                                                          data73,
                                                                                                        ) <
                                                                                                        1
                                                                                                      ) {
                                                                                                        validate10.errors =
                                                                                                          [
                                                                                                            {
                                                                                                              instancePath:
                                                                                                                instancePath +
                                                                                                                '/chunks/' +
                                                                                                                i0 +
                                                                                                                '/entityIds/examples/' +
                                                                                                                i3,
                                                                                                              schemaPath:
                                                                                                                '#/properties/chunks/items/properties/entityIds/properties/examples/items/minLength',
                                                                                                              keyword:
                                                                                                                'minLength',
                                                                                                              params:
                                                                                                                {
                                                                                                                  limit: 1,
                                                                                                                },
                                                                                                              message:
                                                                                                                'must NOT have fewer than 1 characters',
                                                                                                            },
                                                                                                          ];
                                                                                                        return false;
                                                                                                      } else {
                                                                                                        if (
                                                                                                          !pattern5.test(
                                                                                                            data73,
                                                                                                          )
                                                                                                        ) {
                                                                                                          validate10.errors =
                                                                                                            [
                                                                                                              {
                                                                                                                instancePath:
                                                                                                                  instancePath +
                                                                                                                  '/chunks/' +
                                                                                                                  i0 +
                                                                                                                  '/entityIds/examples/' +
                                                                                                                  i3,
                                                                                                                schemaPath:
                                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/examples/items/pattern',
                                                                                                                keyword:
                                                                                                                  'pattern',
                                                                                                                params:
                                                                                                                  {
                                                                                                                    pattern:
                                                                                                                      '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                                  },
                                                                                                                message:
                                                                                                                  'must match pattern "' +
                                                                                                                  '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                                  '"',
                                                                                                              },
                                                                                                            ];
                                                                                                          return false;
                                                                                                        }
                                                                                                      }
                                                                                                    }
                                                                                                  } else {
                                                                                                    validate10.errors =
                                                                                                      [
                                                                                                        {
                                                                                                          instancePath:
                                                                                                            instancePath +
                                                                                                            '/chunks/' +
                                                                                                            i0 +
                                                                                                            '/entityIds/examples/' +
                                                                                                            i3,
                                                                                                          schemaPath:
                                                                                                            '#/properties/chunks/items/properties/entityIds/properties/examples/items/type',
                                                                                                          keyword:
                                                                                                            'type',
                                                                                                          params:
                                                                                                            {
                                                                                                              type: 'string',
                                                                                                            },
                                                                                                          message:
                                                                                                            'must be string',
                                                                                                        },
                                                                                                      ];
                                                                                                    return false;
                                                                                                  }
                                                                                                }
                                                                                                var valid14 =
                                                                                                  _errs114 ===
                                                                                                  errors;
                                                                                                if (
                                                                                                  !valid14
                                                                                                ) {
                                                                                                  break;
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        } else {
                                                                                          validate10.errors =
                                                                                            [
                                                                                              {
                                                                                                instancePath:
                                                                                                  instancePath +
                                                                                                  '/chunks/' +
                                                                                                  i0 +
                                                                                                  '/entityIds/examples',
                                                                                                schemaPath:
                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/examples/type',
                                                                                                keyword:
                                                                                                  'type',
                                                                                                params:
                                                                                                  {
                                                                                                    type: 'array',
                                                                                                  },
                                                                                                message:
                                                                                                  'must be array',
                                                                                              },
                                                                                            ];
                                                                                          return false;
                                                                                        }
                                                                                      }
                                                                                      var valid11 =
                                                                                        _errs112 ===
                                                                                        errors;
                                                                                    } else {
                                                                                      var valid11 = true;
                                                                                    }
                                                                                    if (valid11) {
                                                                                      if (
                                                                                        data67.exercises !==
                                                                                          undefined &&
                                                                                        func0.call(
                                                                                          data67,
                                                                                          'exercises',
                                                                                        )
                                                                                      ) {
                                                                                        let data74 =
                                                                                          data67.exercises;
                                                                                        const _errs116 =
                                                                                          errors;
                                                                                        if (
                                                                                          errors ===
                                                                                          _errs116
                                                                                        ) {
                                                                                          if (
                                                                                            Array.isArray(
                                                                                              data74,
                                                                                            )
                                                                                          ) {
                                                                                            if (
                                                                                              data74.length >
                                                                                              900
                                                                                            ) {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/entityIds/exercises',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/entityIds/properties/exercises/maxItems',
                                                                                                    keyword:
                                                                                                      'maxItems',
                                                                                                    params:
                                                                                                      {
                                                                                                        limit: 900,
                                                                                                      },
                                                                                                    message:
                                                                                                      'must NOT have more than 900 items',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            } else {
                                                                                              if (
                                                                                                data74.length <
                                                                                                0
                                                                                              ) {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/entityIds/exercises',
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/entityIds/properties/exercises/minItems',
                                                                                                      keyword:
                                                                                                        'minItems',
                                                                                                      params:
                                                                                                        {
                                                                                                          limit: 0,
                                                                                                        },
                                                                                                      message:
                                                                                                        'must NOT have fewer than 0 items',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              } else {
                                                                                                var valid15 = true;
                                                                                                const len4 =
                                                                                                  data74.length;
                                                                                                for (
                                                                                                  let i4 = 0;
                                                                                                  i4 <
                                                                                                  len4;
                                                                                                  i4++
                                                                                                ) {
                                                                                                  let data75 =
                                                                                                    data74[
                                                                                                      i4
                                                                                                    ];
                                                                                                  const _errs118 =
                                                                                                    errors;
                                                                                                  if (
                                                                                                    errors ===
                                                                                                    _errs118
                                                                                                  ) {
                                                                                                    if (
                                                                                                      typeof data75 ===
                                                                                                      'string'
                                                                                                    ) {
                                                                                                      if (
                                                                                                        func163(
                                                                                                          data75,
                                                                                                        ) >
                                                                                                        180
                                                                                                      ) {
                                                                                                        validate10.errors =
                                                                                                          [
                                                                                                            {
                                                                                                              instancePath:
                                                                                                                instancePath +
                                                                                                                '/chunks/' +
                                                                                                                i0 +
                                                                                                                '/entityIds/exercises/' +
                                                                                                                i4,
                                                                                                              schemaPath:
                                                                                                                '#/properties/chunks/items/properties/entityIds/properties/exercises/items/maxLength',
                                                                                                              keyword:
                                                                                                                'maxLength',
                                                                                                              params:
                                                                                                                {
                                                                                                                  limit: 180,
                                                                                                                },
                                                                                                              message:
                                                                                                                'must NOT have more than 180 characters',
                                                                                                            },
                                                                                                          ];
                                                                                                        return false;
                                                                                                      } else {
                                                                                                        if (
                                                                                                          func163(
                                                                                                            data75,
                                                                                                          ) <
                                                                                                          1
                                                                                                        ) {
                                                                                                          validate10.errors =
                                                                                                            [
                                                                                                              {
                                                                                                                instancePath:
                                                                                                                  instancePath +
                                                                                                                  '/chunks/' +
                                                                                                                  i0 +
                                                                                                                  '/entityIds/exercises/' +
                                                                                                                  i4,
                                                                                                                schemaPath:
                                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/exercises/items/minLength',
                                                                                                                keyword:
                                                                                                                  'minLength',
                                                                                                                params:
                                                                                                                  {
                                                                                                                    limit: 1,
                                                                                                                  },
                                                                                                                message:
                                                                                                                  'must NOT have fewer than 1 characters',
                                                                                                              },
                                                                                                            ];
                                                                                                          return false;
                                                                                                        } else {
                                                                                                          if (
                                                                                                            !pattern5.test(
                                                                                                              data75,
                                                                                                            )
                                                                                                          ) {
                                                                                                            validate10.errors =
                                                                                                              [
                                                                                                                {
                                                                                                                  instancePath:
                                                                                                                    instancePath +
                                                                                                                    '/chunks/' +
                                                                                                                    i0 +
                                                                                                                    '/entityIds/exercises/' +
                                                                                                                    i4,
                                                                                                                  schemaPath:
                                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/exercises/items/pattern',
                                                                                                                  keyword:
                                                                                                                    'pattern',
                                                                                                                  params:
                                                                                                                    {
                                                                                                                      pattern:
                                                                                                                        '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                                    },
                                                                                                                  message:
                                                                                                                    'must match pattern "' +
                                                                                                                    '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                                    '"',
                                                                                                                },
                                                                                                              ];
                                                                                                            return false;
                                                                                                          }
                                                                                                        }
                                                                                                      }
                                                                                                    } else {
                                                                                                      validate10.errors =
                                                                                                        [
                                                                                                          {
                                                                                                            instancePath:
                                                                                                              instancePath +
                                                                                                              '/chunks/' +
                                                                                                              i0 +
                                                                                                              '/entityIds/exercises/' +
                                                                                                              i4,
                                                                                                            schemaPath:
                                                                                                              '#/properties/chunks/items/properties/entityIds/properties/exercises/items/type',
                                                                                                            keyword:
                                                                                                              'type',
                                                                                                            params:
                                                                                                              {
                                                                                                                type: 'string',
                                                                                                              },
                                                                                                            message:
                                                                                                              'must be string',
                                                                                                          },
                                                                                                        ];
                                                                                                      return false;
                                                                                                    }
                                                                                                  }
                                                                                                  var valid15 =
                                                                                                    _errs118 ===
                                                                                                    errors;
                                                                                                  if (
                                                                                                    !valid15
                                                                                                  ) {
                                                                                                    break;
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          } else {
                                                                                            validate10.errors =
                                                                                              [
                                                                                                {
                                                                                                  instancePath:
                                                                                                    instancePath +
                                                                                                    '/chunks/' +
                                                                                                    i0 +
                                                                                                    '/entityIds/exercises',
                                                                                                  schemaPath:
                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/exercises/type',
                                                                                                  keyword:
                                                                                                    'type',
                                                                                                  params:
                                                                                                    {
                                                                                                      type: 'array',
                                                                                                    },
                                                                                                  message:
                                                                                                    'must be array',
                                                                                                },
                                                                                              ];
                                                                                            return false;
                                                                                          }
                                                                                        }
                                                                                        var valid11 =
                                                                                          _errs116 ===
                                                                                          errors;
                                                                                      } else {
                                                                                        var valid11 = true;
                                                                                      }
                                                                                      if (valid11) {
                                                                                        if (
                                                                                          data67.knowledge !==
                                                                                            undefined &&
                                                                                          func0.call(
                                                                                            data67,
                                                                                            'knowledge',
                                                                                          )
                                                                                        ) {
                                                                                          let data76 =
                                                                                            data67.knowledge;
                                                                                          const _errs120 =
                                                                                            errors;
                                                                                          if (
                                                                                            errors ===
                                                                                            _errs120
                                                                                          ) {
                                                                                            if (
                                                                                              Array.isArray(
                                                                                                data76,
                                                                                              )
                                                                                            ) {
                                                                                              if (
                                                                                                data76.length >
                                                                                                900
                                                                                              ) {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/entityIds/knowledge',
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/entityIds/properties/knowledge/maxItems',
                                                                                                      keyword:
                                                                                                        'maxItems',
                                                                                                      params:
                                                                                                        {
                                                                                                          limit: 900,
                                                                                                        },
                                                                                                      message:
                                                                                                        'must NOT have more than 900 items',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              } else {
                                                                                                if (
                                                                                                  data76.length <
                                                                                                  0
                                                                                                ) {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/entityIds/knowledge',
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/entityIds/properties/knowledge/minItems',
                                                                                                        keyword:
                                                                                                          'minItems',
                                                                                                        params:
                                                                                                          {
                                                                                                            limit: 0,
                                                                                                          },
                                                                                                        message:
                                                                                                          'must NOT have fewer than 0 items',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                } else {
                                                                                                  var valid16 = true;
                                                                                                  const len5 =
                                                                                                    data76.length;
                                                                                                  for (
                                                                                                    let i5 = 0;
                                                                                                    i5 <
                                                                                                    len5;
                                                                                                    i5++
                                                                                                  ) {
                                                                                                    let data77 =
                                                                                                      data76[
                                                                                                        i5
                                                                                                      ];
                                                                                                    const _errs122 =
                                                                                                      errors;
                                                                                                    if (
                                                                                                      errors ===
                                                                                                      _errs122
                                                                                                    ) {
                                                                                                      if (
                                                                                                        typeof data77 ===
                                                                                                        'string'
                                                                                                      ) {
                                                                                                        if (
                                                                                                          func163(
                                                                                                            data77,
                                                                                                          ) >
                                                                                                          180
                                                                                                        ) {
                                                                                                          validate10.errors =
                                                                                                            [
                                                                                                              {
                                                                                                                instancePath:
                                                                                                                  instancePath +
                                                                                                                  '/chunks/' +
                                                                                                                  i0 +
                                                                                                                  '/entityIds/knowledge/' +
                                                                                                                  i5,
                                                                                                                schemaPath:
                                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/knowledge/items/maxLength',
                                                                                                                keyword:
                                                                                                                  'maxLength',
                                                                                                                params:
                                                                                                                  {
                                                                                                                    limit: 180,
                                                                                                                  },
                                                                                                                message:
                                                                                                                  'must NOT have more than 180 characters',
                                                                                                              },
                                                                                                            ];
                                                                                                          return false;
                                                                                                        } else {
                                                                                                          if (
                                                                                                            func163(
                                                                                                              data77,
                                                                                                            ) <
                                                                                                            1
                                                                                                          ) {
                                                                                                            validate10.errors =
                                                                                                              [
                                                                                                                {
                                                                                                                  instancePath:
                                                                                                                    instancePath +
                                                                                                                    '/chunks/' +
                                                                                                                    i0 +
                                                                                                                    '/entityIds/knowledge/' +
                                                                                                                    i5,
                                                                                                                  schemaPath:
                                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/knowledge/items/minLength',
                                                                                                                  keyword:
                                                                                                                    'minLength',
                                                                                                                  params:
                                                                                                                    {
                                                                                                                      limit: 1,
                                                                                                                    },
                                                                                                                  message:
                                                                                                                    'must NOT have fewer than 1 characters',
                                                                                                                },
                                                                                                              ];
                                                                                                            return false;
                                                                                                          } else {
                                                                                                            if (
                                                                                                              !pattern5.test(
                                                                                                                data77,
                                                                                                              )
                                                                                                            ) {
                                                                                                              validate10.errors =
                                                                                                                [
                                                                                                                  {
                                                                                                                    instancePath:
                                                                                                                      instancePath +
                                                                                                                      '/chunks/' +
                                                                                                                      i0 +
                                                                                                                      '/entityIds/knowledge/' +
                                                                                                                      i5,
                                                                                                                    schemaPath:
                                                                                                                      '#/properties/chunks/items/properties/entityIds/properties/knowledge/items/pattern',
                                                                                                                    keyword:
                                                                                                                      'pattern',
                                                                                                                    params:
                                                                                                                      {
                                                                                                                        pattern:
                                                                                                                          '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                                      },
                                                                                                                    message:
                                                                                                                      'must match pattern "' +
                                                                                                                      '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                                      '"',
                                                                                                                  },
                                                                                                                ];
                                                                                                              return false;
                                                                                                            }
                                                                                                          }
                                                                                                        }
                                                                                                      } else {
                                                                                                        validate10.errors =
                                                                                                          [
                                                                                                            {
                                                                                                              instancePath:
                                                                                                                instancePath +
                                                                                                                '/chunks/' +
                                                                                                                i0 +
                                                                                                                '/entityIds/knowledge/' +
                                                                                                                i5,
                                                                                                              schemaPath:
                                                                                                                '#/properties/chunks/items/properties/entityIds/properties/knowledge/items/type',
                                                                                                              keyword:
                                                                                                                'type',
                                                                                                              params:
                                                                                                                {
                                                                                                                  type: 'string',
                                                                                                                },
                                                                                                              message:
                                                                                                                'must be string',
                                                                                                            },
                                                                                                          ];
                                                                                                        return false;
                                                                                                      }
                                                                                                    }
                                                                                                    var valid16 =
                                                                                                      _errs122 ===
                                                                                                      errors;
                                                                                                    if (
                                                                                                      !valid16
                                                                                                    ) {
                                                                                                      break;
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            } else {
                                                                                              validate10.errors =
                                                                                                [
                                                                                                  {
                                                                                                    instancePath:
                                                                                                      instancePath +
                                                                                                      '/chunks/' +
                                                                                                      i0 +
                                                                                                      '/entityIds/knowledge',
                                                                                                    schemaPath:
                                                                                                      '#/properties/chunks/items/properties/entityIds/properties/knowledge/type',
                                                                                                    keyword:
                                                                                                      'type',
                                                                                                    params:
                                                                                                      {
                                                                                                        type: 'array',
                                                                                                      },
                                                                                                    message:
                                                                                                      'must be array',
                                                                                                  },
                                                                                                ];
                                                                                              return false;
                                                                                            }
                                                                                          }
                                                                                          var valid11 =
                                                                                            _errs120 ===
                                                                                            errors;
                                                                                        } else {
                                                                                          var valid11 = true;
                                                                                        }
                                                                                        if (
                                                                                          valid11
                                                                                        ) {
                                                                                          if (
                                                                                            data67.programs !==
                                                                                              undefined &&
                                                                                            func0.call(
                                                                                              data67,
                                                                                              'programs',
                                                                                            )
                                                                                          ) {
                                                                                            let data78 =
                                                                                              data67.programs;
                                                                                            const _errs124 =
                                                                                              errors;
                                                                                            if (
                                                                                              errors ===
                                                                                              _errs124
                                                                                            ) {
                                                                                              if (
                                                                                                Array.isArray(
                                                                                                  data78,
                                                                                                )
                                                                                              ) {
                                                                                                if (
                                                                                                  data78.length >
                                                                                                  900
                                                                                                ) {
                                                                                                  validate10.errors =
                                                                                                    [
                                                                                                      {
                                                                                                        instancePath:
                                                                                                          instancePath +
                                                                                                          '/chunks/' +
                                                                                                          i0 +
                                                                                                          '/entityIds/programs',
                                                                                                        schemaPath:
                                                                                                          '#/properties/chunks/items/properties/entityIds/properties/programs/maxItems',
                                                                                                        keyword:
                                                                                                          'maxItems',
                                                                                                        params:
                                                                                                          {
                                                                                                            limit: 900,
                                                                                                          },
                                                                                                        message:
                                                                                                          'must NOT have more than 900 items',
                                                                                                      },
                                                                                                    ];
                                                                                                  return false;
                                                                                                } else {
                                                                                                  if (
                                                                                                    data78.length <
                                                                                                    0
                                                                                                  ) {
                                                                                                    validate10.errors =
                                                                                                      [
                                                                                                        {
                                                                                                          instancePath:
                                                                                                            instancePath +
                                                                                                            '/chunks/' +
                                                                                                            i0 +
                                                                                                            '/entityIds/programs',
                                                                                                          schemaPath:
                                                                                                            '#/properties/chunks/items/properties/entityIds/properties/programs/minItems',
                                                                                                          keyword:
                                                                                                            'minItems',
                                                                                                          params:
                                                                                                            {
                                                                                                              limit: 0,
                                                                                                            },
                                                                                                          message:
                                                                                                            'must NOT have fewer than 0 items',
                                                                                                        },
                                                                                                      ];
                                                                                                    return false;
                                                                                                  } else {
                                                                                                    var valid17 = true;
                                                                                                    const len6 =
                                                                                                      data78.length;
                                                                                                    for (
                                                                                                      let i6 = 0;
                                                                                                      i6 <
                                                                                                      len6;
                                                                                                      i6++
                                                                                                    ) {
                                                                                                      let data79 =
                                                                                                        data78[
                                                                                                          i6
                                                                                                        ];
                                                                                                      const _errs126 =
                                                                                                        errors;
                                                                                                      if (
                                                                                                        errors ===
                                                                                                        _errs126
                                                                                                      ) {
                                                                                                        if (
                                                                                                          typeof data79 ===
                                                                                                          'string'
                                                                                                        ) {
                                                                                                          if (
                                                                                                            func163(
                                                                                                              data79,
                                                                                                            ) >
                                                                                                            180
                                                                                                          ) {
                                                                                                            validate10.errors =
                                                                                                              [
                                                                                                                {
                                                                                                                  instancePath:
                                                                                                                    instancePath +
                                                                                                                    '/chunks/' +
                                                                                                                    i0 +
                                                                                                                    '/entityIds/programs/' +
                                                                                                                    i6,
                                                                                                                  schemaPath:
                                                                                                                    '#/properties/chunks/items/properties/entityIds/properties/programs/items/maxLength',
                                                                                                                  keyword:
                                                                                                                    'maxLength',
                                                                                                                  params:
                                                                                                                    {
                                                                                                                      limit: 180,
                                                                                                                    },
                                                                                                                  message:
                                                                                                                    'must NOT have more than 180 characters',
                                                                                                                },
                                                                                                              ];
                                                                                                            return false;
                                                                                                          } else {
                                                                                                            if (
                                                                                                              func163(
                                                                                                                data79,
                                                                                                              ) <
                                                                                                              1
                                                                                                            ) {
                                                                                                              validate10.errors =
                                                                                                                [
                                                                                                                  {
                                                                                                                    instancePath:
                                                                                                                      instancePath +
                                                                                                                      '/chunks/' +
                                                                                                                      i0 +
                                                                                                                      '/entityIds/programs/' +
                                                                                                                      i6,
                                                                                                                    schemaPath:
                                                                                                                      '#/properties/chunks/items/properties/entityIds/properties/programs/items/minLength',
                                                                                                                    keyword:
                                                                                                                      'minLength',
                                                                                                                    params:
                                                                                                                      {
                                                                                                                        limit: 1,
                                                                                                                      },
                                                                                                                    message:
                                                                                                                      'must NOT have fewer than 1 characters',
                                                                                                                  },
                                                                                                                ];
                                                                                                              return false;
                                                                                                            } else {
                                                                                                              if (
                                                                                                                !pattern5.test(
                                                                                                                  data79,
                                                                                                                )
                                                                                                              ) {
                                                                                                                validate10.errors =
                                                                                                                  [
                                                                                                                    {
                                                                                                                      instancePath:
                                                                                                                        instancePath +
                                                                                                                        '/chunks/' +
                                                                                                                        i0 +
                                                                                                                        '/entityIds/programs/' +
                                                                                                                        i6,
                                                                                                                      schemaPath:
                                                                                                                        '#/properties/chunks/items/properties/entityIds/properties/programs/items/pattern',
                                                                                                                      keyword:
                                                                                                                        'pattern',
                                                                                                                      params:
                                                                                                                        {
                                                                                                                          pattern:
                                                                                                                            '^[A-Za-z0-9][A-Za-z0-9._-]*$',
                                                                                                                        },
                                                                                                                      message:
                                                                                                                        'must match pattern "' +
                                                                                                                        '^[A-Za-z0-9][A-Za-z0-9._-]*$' +
                                                                                                                        '"',
                                                                                                                    },
                                                                                                                  ];
                                                                                                                return false;
                                                                                                              }
                                                                                                            }
                                                                                                          }
                                                                                                        } else {
                                                                                                          validate10.errors =
                                                                                                            [
                                                                                                              {
                                                                                                                instancePath:
                                                                                                                  instancePath +
                                                                                                                  '/chunks/' +
                                                                                                                  i0 +
                                                                                                                  '/entityIds/programs/' +
                                                                                                                  i6,
                                                                                                                schemaPath:
                                                                                                                  '#/properties/chunks/items/properties/entityIds/properties/programs/items/type',
                                                                                                                keyword:
                                                                                                                  'type',
                                                                                                                params:
                                                                                                                  {
                                                                                                                    type: 'string',
                                                                                                                  },
                                                                                                                message:
                                                                                                                  'must be string',
                                                                                                              },
                                                                                                            ];
                                                                                                          return false;
                                                                                                        }
                                                                                                      }
                                                                                                      var valid17 =
                                                                                                        _errs126 ===
                                                                                                        errors;
                                                                                                      if (
                                                                                                        !valid17
                                                                                                      ) {
                                                                                                        break;
                                                                                                      }
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              } else {
                                                                                                validate10.errors =
                                                                                                  [
                                                                                                    {
                                                                                                      instancePath:
                                                                                                        instancePath +
                                                                                                        '/chunks/' +
                                                                                                        i0 +
                                                                                                        '/entityIds/programs',
                                                                                                      schemaPath:
                                                                                                        '#/properties/chunks/items/properties/entityIds/properties/programs/type',
                                                                                                      keyword:
                                                                                                        'type',
                                                                                                      params:
                                                                                                        {
                                                                                                          type: 'array',
                                                                                                        },
                                                                                                      message:
                                                                                                        'must be array',
                                                                                                    },
                                                                                                  ];
                                                                                                return false;
                                                                                              }
                                                                                            }
                                                                                            var valid11 =
                                                                                              _errs124 ===
                                                                                              errors;
                                                                                          } else {
                                                                                            var valid11 = true;
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          } else {
                                                                            validate10.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/chunks/' +
                                                                                  i0 +
                                                                                  '/entityIds',
                                                                                schemaPath:
                                                                                  '#/properties/chunks/items/properties/entityIds/type',
                                                                                keyword: 'type',
                                                                                params: {
                                                                                  type: 'object',
                                                                                },
                                                                                message:
                                                                                  'must be object',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                        }
                                                                        var valid9 =
                                                                          _errs101 === errors;
                                                                      } else {
                                                                        var valid9 = true;
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  } else {
                                                    validate10.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath + '/chunks/' + i0,
                                                        schemaPath:
                                                          '#/properties/chunks/items/type',
                                                        keyword: 'type',
                                                        params: { type: 'object' },
                                                        message: 'must be object',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                }
                                                var valid8 = _errs71 === errors;
                                                if (!valid8) {
                                                  break;
                                                }
                                              }
                                            }
                                          }
                                        } else {
                                          validate10.errors = [
                                            {
                                              instancePath: instancePath + '/chunks',
                                              schemaPath: '#/properties/chunks/type',
                                              keyword: 'type',
                                              params: { type: 'array' },
                                              message: 'must be array',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid0 = _errs69 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.nodes !== undefined && func0.call(data, 'nodes')) {
                                        let data80 = data.nodes;
                                        const _errs128 = errors;
                                        if (errors === _errs128) {
                                          if (Array.isArray(data80)) {
                                            if (data80.length > 650) {
                                              validate10.errors = [
                                                {
                                                  instancePath: instancePath + '/nodes',
                                                  schemaPath: '#/properties/nodes/maxItems',
                                                  keyword: 'maxItems',
                                                  params: { limit: 650 },
                                                  message: 'must NOT have more than 650 items',
                                                },
                                              ];
                                              return false;
                                            } else {
                                              if (data80.length < 650) {
                                                validate10.errors = [
                                                  {
                                                    instancePath: instancePath + '/nodes',
                                                    schemaPath: '#/properties/nodes/minItems',
                                                    keyword: 'minItems',
                                                    params: { limit: 650 },
                                                    message: 'must NOT have fewer than 650 items',
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                var valid18 = true;
                                                const len7 = data80.length;
                                                for (let i7 = 0; i7 < len7; i7++) {
                                                  let data81 = data80[i7];
                                                  const _errs130 = errors;
                                                  if (errors === _errs130) {
                                                    if (
                                                      data81 &&
                                                      typeof data81 == 'object' &&
                                                      !Array.isArray(data81)
                                                    ) {
                                                      let missing11;
                                                      if (
                                                        ((data81.id === undefined ||
                                                          !func0.call(data81, 'id')) &&
                                                          (missing11 = 'id')) ||
                                                        ((data81.parentId === undefined ||
                                                          !func0.call(data81, 'parentId')) &&
                                                          (missing11 = 'parentId')) ||
                                                        ((data81.order === undefined ||
                                                          !func0.call(data81, 'order')) &&
                                                          (missing11 = 'order')) ||
                                                        ((data81.titleOriginal === undefined ||
                                                          !func0.call(data81, 'titleOriginal')) &&
                                                          (missing11 = 'titleOriginal')) ||
                                                        ((data81.titleDisplay === undefined ||
                                                          !func0.call(data81, 'titleDisplay')) &&
                                                          (missing11 = 'titleDisplay')) ||
                                                        ((data81.category === undefined ||
                                                          !func0.call(data81, 'category')) &&
                                                          (missing11 = 'category')) ||
                                                        ((data81.physicalPage === undefined ||
                                                          !func0.call(data81, 'physicalPage')) &&
                                                          (missing11 = 'physicalPage')) ||
                                                        ((data81.chunkId === undefined ||
                                                          !func0.call(data81, 'chunkId')) &&
                                                          (missing11 = 'chunkId'))
                                                      ) {
                                                        validate10.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath + '/nodes/' + i7,
                                                            schemaPath:
                                                              '#/properties/nodes/items/required',
                                                            keyword: 'required',
                                                            params: { missingProperty: missing11 },
                                                            message:
                                                              "must have required property '" +
                                                              missing11 +
                                                              "'",
                                                          },
                                                        ];
                                                        return false;
                                                      } else {
                                                        const _errs132 = errors;
                                                        for (const key11 of Object.keys(data81)) {
                                                          if (!(
                                                            key11 === 'id' ||
                                                            key11 === 'parentId' ||
                                                            key11 === 'order' ||
                                                            key11 === 'titleOriginal' ||
                                                            key11 === 'titleDisplay' ||
                                                            key11 === 'category' ||
                                                            key11 === 'physicalPage' ||
                                                            key11 === 'chunkId'
                                                          )) {
                                                            validate10.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath + '/nodes/' + i7,
                                                                schemaPath:
                                                                  '#/properties/nodes/items/additionalProperties',
                                                                keyword: 'additionalProperties',
                                                                params: {
                                                                  additionalProperty: key11,
                                                                },
                                                                message:
                                                                  'must NOT have additional properties',
                                                              },
                                                            ];
                                                            return false;
                                                            break;
                                                          }
                                                        }
                                                        if (_errs132 === errors) {
                                                          if (
                                                            data81.id !== undefined &&
                                                            func0.call(data81, 'id')
                                                          ) {
                                                            let data82 = data81.id;
                                                            const _errs133 = errors;
                                                            if (errors === _errs133) {
                                                              if (typeof data82 === 'string') {
                                                                if (func163(data82) > 80) {
                                                                  validate10.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/nodes/' +
                                                                        i7 +
                                                                        '/id',
                                                                      schemaPath:
                                                                        '#/properties/nodes/items/properties/id/maxLength',
                                                                      keyword: 'maxLength',
                                                                      params: { limit: 80 },
                                                                      message:
                                                                        'must NOT have more than 80 characters',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                } else {
                                                                  if (func163(data82) < 1) {
                                                                    validate10.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/nodes/' +
                                                                          i7 +
                                                                          '/id',
                                                                        schemaPath:
                                                                          '#/properties/nodes/items/properties/id/minLength',
                                                                        keyword: 'minLength',
                                                                        params: { limit: 1 },
                                                                        message:
                                                                          'must NOT have fewer than 1 characters',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  } else {
                                                                    if (!pattern2.test(data82)) {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/nodes/' +
                                                                            i7 +
                                                                            '/id',
                                                                          schemaPath:
                                                                            '#/properties/nodes/items/properties/id/pattern',
                                                                          keyword: 'pattern',
                                                                          params: {
                                                                            pattern:
                                                                              '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
                                                                          },
                                                                          message:
                                                                            'must match pattern "' +
                                                                            '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$' +
                                                                            '"',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                  }
                                                                }
                                                              } else {
                                                                validate10.errors = [
                                                                  {
                                                                    instancePath:
                                                                      instancePath +
                                                                      '/nodes/' +
                                                                      i7 +
                                                                      '/id',
                                                                    schemaPath:
                                                                      '#/properties/nodes/items/properties/id/type',
                                                                    keyword: 'type',
                                                                    params: { type: 'string' },
                                                                    message: 'must be string',
                                                                  },
                                                                ];
                                                                return false;
                                                              }
                                                            }
                                                            var valid19 = _errs133 === errors;
                                                          } else {
                                                            var valid19 = true;
                                                          }
                                                          if (valid19) {
                                                            if (
                                                              data81.parentId !== undefined &&
                                                              func0.call(data81, 'parentId')
                                                            ) {
                                                              let data83 = data81.parentId;
                                                              const _errs135 = errors;
                                                              const _errs136 = errors;
                                                              let valid20 = false;
                                                              const _errs137 = errors;
                                                              if (errors === _errs137) {
                                                                if (typeof data83 === 'string') {
                                                                  if (func163(data83) > 80) {
                                                                    const err0 = {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/nodes/' +
                                                                        i7 +
                                                                        '/parentId',
                                                                      schemaPath:
                                                                        '#/properties/nodes/items/properties/parentId/anyOf/0/maxLength',
                                                                      keyword: 'maxLength',
                                                                      params: { limit: 80 },
                                                                      message:
                                                                        'must NOT have more than 80 characters',
                                                                    };
                                                                    if (vErrors === null) {
                                                                      vErrors = [err0];
                                                                    } else {
                                                                      vErrors.push(err0);
                                                                    }
                                                                    errors++;
                                                                  } else {
                                                                    if (func163(data83) < 1) {
                                                                      const err1 = {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/nodes/' +
                                                                          i7 +
                                                                          '/parentId',
                                                                        schemaPath:
                                                                          '#/properties/nodes/items/properties/parentId/anyOf/0/minLength',
                                                                        keyword: 'minLength',
                                                                        params: { limit: 1 },
                                                                        message:
                                                                          'must NOT have fewer than 1 characters',
                                                                      };
                                                                      if (vErrors === null) {
                                                                        vErrors = [err1];
                                                                      } else {
                                                                        vErrors.push(err1);
                                                                      }
                                                                      errors++;
                                                                    } else {
                                                                      if (!pattern2.test(data83)) {
                                                                        const err2 = {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/nodes/' +
                                                                            i7 +
                                                                            '/parentId',
                                                                          schemaPath:
                                                                            '#/properties/nodes/items/properties/parentId/anyOf/0/pattern',
                                                                          keyword: 'pattern',
                                                                          params: {
                                                                            pattern:
                                                                              '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$',
                                                                          },
                                                                          message:
                                                                            'must match pattern "' +
                                                                            '^c6\\.(?:ch[0-9]{2}|app[AB]|s(?:[0-9]+|[AB])(?:\\.[0-9]+)+)$' +
                                                                            '"',
                                                                        };
                                                                        if (vErrors === null) {
                                                                          vErrors = [err2];
                                                                        } else {
                                                                          vErrors.push(err2);
                                                                        }
                                                                        errors++;
                                                                      }
                                                                    }
                                                                  }
                                                                } else {
                                                                  const err3 = {
                                                                    instancePath:
                                                                      instancePath +
                                                                      '/nodes/' +
                                                                      i7 +
                                                                      '/parentId',
                                                                    schemaPath:
                                                                      '#/properties/nodes/items/properties/parentId/anyOf/0/type',
                                                                    keyword: 'type',
                                                                    params: { type: 'string' },
                                                                    message: 'must be string',
                                                                  };
                                                                  if (vErrors === null) {
                                                                    vErrors = [err3];
                                                                  } else {
                                                                    vErrors.push(err3);
                                                                  }
                                                                  errors++;
                                                                }
                                                              }
                                                              var _valid0 = _errs137 === errors;
                                                              valid20 = valid20 || _valid0;
                                                              if (!valid20) {
                                                                const _errs139 = errors;
                                                                if (data83 !== null) {
                                                                  const err4 = {
                                                                    instancePath:
                                                                      instancePath +
                                                                      '/nodes/' +
                                                                      i7 +
                                                                      '/parentId',
                                                                    schemaPath:
                                                                      '#/properties/nodes/items/properties/parentId/anyOf/1/type',
                                                                    keyword: 'type',
                                                                    params: { type: 'null' },
                                                                    message: 'must be null',
                                                                  };
                                                                  if (vErrors === null) {
                                                                    vErrors = [err4];
                                                                  } else {
                                                                    vErrors.push(err4);
                                                                  }
                                                                  errors++;
                                                                }
                                                                var _valid0 = _errs139 === errors;
                                                                valid20 = valid20 || _valid0;
                                                              }
                                                              if (!valid20) {
                                                                const err5 = {
                                                                  instancePath:
                                                                    instancePath +
                                                                    '/nodes/' +
                                                                    i7 +
                                                                    '/parentId',
                                                                  schemaPath:
                                                                    '#/properties/nodes/items/properties/parentId/anyOf',
                                                                  keyword: 'anyOf',
                                                                  params: {},
                                                                  message:
                                                                    'must match a schema in anyOf',
                                                                };
                                                                if (vErrors === null) {
                                                                  vErrors = [err5];
                                                                } else {
                                                                  vErrors.push(err5);
                                                                }
                                                                errors++;
                                                                validate10.errors = vErrors;
                                                                return false;
                                                              } else {
                                                                errors = _errs136;
                                                                if (vErrors !== null) {
                                                                  if (_errs136) {
                                                                    vErrors.length = _errs136;
                                                                  } else {
                                                                    vErrors = null;
                                                                  }
                                                                }
                                                              }
                                                              var valid19 = _errs135 === errors;
                                                            } else {
                                                              var valid19 = true;
                                                            }
                                                            if (valid19) {
                                                              if (
                                                                data81.order !== undefined &&
                                                                func0.call(data81, 'order')
                                                              ) {
                                                                let data84 = data81.order;
                                                                const _errs141 = errors;
                                                                if (!(
                                                                  typeof data84 == 'number' &&
                                                                  !(data84 % 1) &&
                                                                  !isNaN(data84) &&
                                                                  isFinite(data84)
                                                                )) {
                                                                  validate10.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/nodes/' +
                                                                        i7 +
                                                                        '/order',
                                                                      schemaPath:
                                                                        '#/properties/nodes/items/properties/order/type',
                                                                      keyword: 'type',
                                                                      params: { type: 'integer' },
                                                                      message: 'must be integer',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                }
                                                                if (errors === _errs141) {
                                                                  if (
                                                                    typeof data84 == 'number' &&
                                                                    isFinite(data84)
                                                                  ) {
                                                                    if (
                                                                      data84 > 650 ||
                                                                      isNaN(data84)
                                                                    ) {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/nodes/' +
                                                                            i7 +
                                                                            '/order',
                                                                          schemaPath:
                                                                            '#/properties/nodes/items/properties/order/maximum',
                                                                          keyword: 'maximum',
                                                                          params: {
                                                                            comparison: '<=',
                                                                            limit: 650,
                                                                          },
                                                                          message: 'must be <= 650',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    } else {
                                                                      if (
                                                                        data84 < 1 ||
                                                                        isNaN(data84)
                                                                      ) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/nodes/' +
                                                                              i7 +
                                                                              '/order',
                                                                            schemaPath:
                                                                              '#/properties/nodes/items/properties/order/minimum',
                                                                            keyword: 'minimum',
                                                                            params: {
                                                                              comparison: '>=',
                                                                              limit: 1,
                                                                            },
                                                                            message: 'must be >= 1',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                                var valid19 = _errs141 === errors;
                                                              } else {
                                                                var valid19 = true;
                                                              }
                                                              if (valid19) {
                                                                if (
                                                                  data81.titleOriginal !==
                                                                    undefined &&
                                                                  func0.call(
                                                                    data81,
                                                                    'titleOriginal',
                                                                  )
                                                                ) {
                                                                  let data85 = data81.titleOriginal;
                                                                  const _errs143 = errors;
                                                                  if (errors === _errs143) {
                                                                    if (
                                                                      typeof data85 === 'string'
                                                                    ) {
                                                                      if (func163(data85) > 500) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/nodes/' +
                                                                              i7 +
                                                                              '/titleOriginal',
                                                                            schemaPath:
                                                                              '#/properties/nodes/items/properties/titleOriginal/maxLength',
                                                                            keyword: 'maxLength',
                                                                            params: { limit: 500 },
                                                                            message:
                                                                              'must NOT have more than 500 characters',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      } else {
                                                                        if (func163(data85) < 1) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/nodes/' +
                                                                                i7 +
                                                                                '/titleOriginal',
                                                                              schemaPath:
                                                                                '#/properties/nodes/items/properties/titleOriginal/minLength',
                                                                              keyword: 'minLength',
                                                                              params: { limit: 1 },
                                                                              message:
                                                                                'must NOT have fewer than 1 characters',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                    } else {
                                                                      validate10.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/nodes/' +
                                                                            i7 +
                                                                            '/titleOriginal',
                                                                          schemaPath:
                                                                            '#/properties/nodes/items/properties/titleOriginal/type',
                                                                          keyword: 'type',
                                                                          params: {
                                                                            type: 'string',
                                                                          },
                                                                          message: 'must be string',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                  }
                                                                  var valid19 = _errs143 === errors;
                                                                } else {
                                                                  var valid19 = true;
                                                                }
                                                                if (valid19) {
                                                                  if (
                                                                    data81.titleDisplay !==
                                                                      undefined &&
                                                                    func0.call(
                                                                      data81,
                                                                      'titleDisplay',
                                                                    )
                                                                  ) {
                                                                    let data86 =
                                                                      data81.titleDisplay;
                                                                    const _errs145 = errors;
                                                                    if (errors === _errs145) {
                                                                      if (
                                                                        typeof data86 === 'string'
                                                                      ) {
                                                                        if (func163(data86) > 500) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/nodes/' +
                                                                                i7 +
                                                                                '/titleDisplay',
                                                                              schemaPath:
                                                                                '#/properties/nodes/items/properties/titleDisplay/maxLength',
                                                                              keyword: 'maxLength',
                                                                              params: {
                                                                                limit: 500,
                                                                              },
                                                                              message:
                                                                                'must NOT have more than 500 characters',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        } else {
                                                                          if (func163(data86) < 1) {
                                                                            validate10.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/nodes/' +
                                                                                  i7 +
                                                                                  '/titleDisplay',
                                                                                schemaPath:
                                                                                  '#/properties/nodes/items/properties/titleDisplay/minLength',
                                                                                keyword:
                                                                                  'minLength',
                                                                                params: {
                                                                                  limit: 1,
                                                                                },
                                                                                message:
                                                                                  'must NOT have fewer than 1 characters',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                        }
                                                                      } else {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/nodes/' +
                                                                              i7 +
                                                                              '/titleDisplay',
                                                                            schemaPath:
                                                                              '#/properties/nodes/items/properties/titleDisplay/type',
                                                                            keyword: 'type',
                                                                            params: {
                                                                              type: 'string',
                                                                            },
                                                                            message:
                                                                              'must be string',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                    var valid19 =
                                                                      _errs145 === errors;
                                                                  } else {
                                                                    var valid19 = true;
                                                                  }
                                                                  if (valid19) {
                                                                    if (
                                                                      data81.category !==
                                                                        undefined &&
                                                                      func0.call(data81, 'category')
                                                                    ) {
                                                                      let data87 = data81.category;
                                                                      const _errs147 = errors;
                                                                      if (!(
                                                                        data87 ===
                                                                          'directory-container' ||
                                                                        data87 ===
                                                                          'exercise-group' ||
                                                                        data87 ===
                                                                          'teaching-lesson' ||
                                                                        data87 ===
                                                                          'reference-answer-or-bibliography'
                                                                      )) {
                                                                        validate10.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/nodes/' +
                                                                              i7 +
                                                                              '/category',
                                                                            schemaPath:
                                                                              '#/properties/nodes/items/properties/category/enum',
                                                                            keyword: 'enum',
                                                                            params: {
                                                                              allowedValues:
                                                                                schema11.properties
                                                                                  .nodes.items
                                                                                  .properties
                                                                                  .category.enum,
                                                                            },
                                                                            message:
                                                                              'must be equal to one of the allowed values',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                      var valid19 =
                                                                        _errs147 === errors;
                                                                    } else {
                                                                      var valid19 = true;
                                                                    }
                                                                    if (valid19) {
                                                                      if (
                                                                        data81.physicalPage !==
                                                                          undefined &&
                                                                        func0.call(
                                                                          data81,
                                                                          'physicalPage',
                                                                        )
                                                                      ) {
                                                                        let data88 =
                                                                          data81.physicalPage;
                                                                        const _errs148 = errors;
                                                                        if (!(
                                                                          typeof data88 ==
                                                                            'number' &&
                                                                          !(data88 % 1) &&
                                                                          !isNaN(data88) &&
                                                                          isFinite(data88)
                                                                        )) {
                                                                          validate10.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/nodes/' +
                                                                                i7 +
                                                                                '/physicalPage',
                                                                              schemaPath:
                                                                                '#/properties/nodes/items/properties/physicalPage/type',
                                                                              keyword: 'type',
                                                                              params: {
                                                                                type: 'integer',
                                                                              },
                                                                              message:
                                                                                'must be integer',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                        if (errors === _errs148) {
                                                                          if (
                                                                            typeof data88 ==
                                                                              'number' &&
                                                                            isFinite(data88)
                                                                          ) {
                                                                            if (
                                                                              data88 > 1635 ||
                                                                              isNaN(data88)
                                                                            ) {
                                                                              validate10.errors = [
                                                                                {
                                                                                  instancePath:
                                                                                    instancePath +
                                                                                    '/nodes/' +
                                                                                    i7 +
                                                                                    '/physicalPage',
                                                                                  schemaPath:
                                                                                    '#/properties/nodes/items/properties/physicalPage/maximum',
                                                                                  keyword:
                                                                                    'maximum',
                                                                                  params: {
                                                                                    comparison:
                                                                                      '<=',
                                                                                    limit: 1635,
                                                                                  },
                                                                                  message:
                                                                                    'must be <= 1635',
                                                                                },
                                                                              ];
                                                                              return false;
                                                                            } else {
                                                                              if (
                                                                                data88 < 1 ||
                                                                                isNaN(data88)
                                                                              ) {
                                                                                validate10.errors =
                                                                                  [
                                                                                    {
                                                                                      instancePath:
                                                                                        instancePath +
                                                                                        '/nodes/' +
                                                                                        i7 +
                                                                                        '/physicalPage',
                                                                                      schemaPath:
                                                                                        '#/properties/nodes/items/properties/physicalPage/minimum',
                                                                                      keyword:
                                                                                        'minimum',
                                                                                      params: {
                                                                                        comparison:
                                                                                          '>=',
                                                                                        limit: 1,
                                                                                      },
                                                                                      message:
                                                                                        'must be >= 1',
                                                                                    },
                                                                                  ];
                                                                                return false;
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                        var valid19 =
                                                                          _errs148 === errors;
                                                                      } else {
                                                                        var valid19 = true;
                                                                      }
                                                                      if (valid19) {
                                                                        if (
                                                                          data81.chunkId !==
                                                                            undefined &&
                                                                          func0.call(
                                                                            data81,
                                                                            'chunkId',
                                                                          )
                                                                        ) {
                                                                          let data89 =
                                                                            data81.chunkId;
                                                                          const _errs150 = errors;
                                                                          if (!(
                                                                            data89 === 'ch01' ||
                                                                            data89 === 'ch02' ||
                                                                            data89 === 'ch03' ||
                                                                            data89 === 'ch04' ||
                                                                            data89 === 'ch05' ||
                                                                            data89 === 'ch06' ||
                                                                            data89 === 'ch07' ||
                                                                            data89 === 'ch08' ||
                                                                            data89 === 'ch09' ||
                                                                            data89 === 'ch10' ||
                                                                            data89 === 'ch11' ||
                                                                            data89 === 'ch12' ||
                                                                            data89 === 'ch13' ||
                                                                            data89 === 'ch14' ||
                                                                            data89 === 'ch15' ||
                                                                            data89 === 'ch16' ||
                                                                            data89 === 'ch17' ||
                                                                            data89 === 'chA' ||
                                                                            data89 === 'chB'
                                                                          )) {
                                                                            validate10.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/nodes/' +
                                                                                  i7 +
                                                                                  '/chunkId',
                                                                                schemaPath:
                                                                                  '#/properties/nodes/items/properties/chunkId/enum',
                                                                                keyword: 'enum',
                                                                                params: {
                                                                                  allowedValues:
                                                                                    schema11
                                                                                      .properties
                                                                                      .nodes.items
                                                                                      .properties
                                                                                      .chunkId.enum,
                                                                                },
                                                                                message:
                                                                                  'must be equal to one of the allowed values',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                          var valid19 =
                                                                            _errs150 === errors;
                                                                        } else {
                                                                          var valid19 = true;
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    } else {
                                                      validate10.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath + '/nodes/' + i7,
                                                          schemaPath:
                                                            '#/properties/nodes/items/type',
                                                          keyword: 'type',
                                                          params: { type: 'object' },
                                                          message: 'must be object',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  }
                                                  var valid18 = _errs130 === errors;
                                                  if (!valid18) {
                                                    break;
                                                  }
                                                }
                                              }
                                            }
                                          } else {
                                            validate10.errors = [
                                              {
                                                instancePath: instancePath + '/nodes',
                                                schemaPath: '#/properties/nodes/type',
                                                keyword: 'type',
                                                params: { type: 'array' },
                                                message: 'must be array',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                        var valid0 = _errs128 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate10.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate10.errors = vErrors;
  return errors === 0;
}
