import type { EntityRef } from './types';

export type C6ChunkId =
  | 'ch01'
  | 'ch02'
  | 'ch03'
  | 'ch04'
  | 'ch05'
  | 'ch06'
  | 'ch07'
  | 'ch08'
  | 'ch09'
  | 'ch10'
  | 'ch11'
  | 'ch12'
  | 'ch13'
  | 'ch14'
  | 'ch15'
  | 'ch16'
  | 'ch17'
  | 'chA'
  | 'chB';
export type C6ChunkKind = 'course-chapter' | 'reference-appendix';
export type C6NodeCategory =
  'directory-container' | 'exercise-group' | 'teaching-lesson' | 'reference-answer-or-bibliography';
export interface C6SourceLocator {
  readonly physicalPage: number;
  readonly originalPrintPage: null;
}
export interface C6ChunkCounts {
  readonly nodes: number;
  readonly lessons: number;
  readonly activities: number;
  readonly examples: number;
  readonly exercises: number;
  readonly knowledge: number;
}
export interface C6CourseCounts {
  readonly nodes: 650;
  readonly lessons: 404;
  readonly concepts: 404;
  readonly requiredLessons: 404;
  readonly optionalTeachingLessons: 0;
  readonly directoryContainers: 112;
  readonly exerciseGroupContainers: 34;
  readonly referenceLeaves: 100;
  readonly activities: 793;
  readonly requiredActivities: 448;
  readonly optionalActivities: 345;
  readonly sourceReviewChecks: 177;
  readonly sourceProgrammingChecks: 168;
  readonly executionExercises: 44;
  readonly judgeGroups: 176;
  readonly examples: 232;
  readonly nonreadingExamples: 131;
  readonly readingExamples: 101;
  readonly knowledgeNodes: 421;
  readonly lazyChunks: 19;
}
export interface C6NavigationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly order: number;
  readonly titleOriginal: string;
  readonly titleDisplay: string;
  readonly category: C6NodeCategory;
  readonly physicalPage: number;
  readonly chunkId: C6ChunkId;
}
export interface C6ChunkEntry {
  readonly id: C6ChunkId;
  readonly kind: C6ChunkKind;
  readonly rootNodeId: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly counts: C6ChunkCounts;
  readonly entityIds: Readonly<
    Record<'lessons' | 'activities' | 'examples' | 'exercises' | 'knowledge', readonly string[]>
  >;
}
export interface C6CourseManifest {
  readonly contractVersion: '2.0.0';
  readonly packageRef: { readonly id: 'content.c.primer6'; readonly version: '1.0.0' };
  readonly languageRef: { readonly id: 'lang.c'; readonly version: '1.0.0' };
  readonly engineRef: { readonly id: 'engine.rust.c6'; readonly version: '0.1.0' };
  readonly engineBuildSha256: string;
  readonly scopeRevision: 'user-20261102-b-reference-only';
  readonly source: {
    readonly id: 'source.c.primer6';
    readonly edition: 6;
    readonly sha256: string;
  };
  readonly designSha256: string;
  readonly scopeSha256: string;
  readonly counts: C6CourseCounts;
  readonly budgets: {
    readonly packageBytes: 20971520;
    readonly manifestBytes: 262144;
    readonly chunkBytes: 1048576;
    readonly sourceBytes: 32768;
  };
  readonly compatibilityChunkId: 'chA';
  readonly executionEvidenceSha256: string;
  readonly authoredSources: readonly { readonly path: string; readonly sha256: string }[];
  readonly chunks: readonly C6ChunkEntry[];
  readonly nodes: readonly C6NavigationNode[];
}
export interface C6BodyNode {
  readonly ref: EntityRef;
  readonly sourceNodeId: string;
  readonly parentRef: EntityRef | null;
  readonly order: number;
  readonly titleOriginal: string;
  readonly titleDisplay: string;
  readonly category: C6NodeCategory;
  readonly area: 'course' | 'reference';
  readonly locator: C6SourceLocator;
  readonly objective: string;
  readonly body: string;
  readonly lessonRef: EntityRef | null;
  readonly activityRefs: readonly EntityRef[];
  readonly exampleRefs: readonly EntityRef[];
  readonly platformSupplement: true;
}
export interface C6CourseLesson {
  readonly ref: EntityRef;
  readonly sourceNodeRef: EntityRef;
  readonly chapterRef: EntityRef;
  readonly knowledgeRefs: readonly EntityRef[];
  readonly mandatory: true;
  readonly learningRevision: 1;
  readonly acceptedPriorVersions: readonly string[];
  readonly requiredActivityRefs: readonly EntityRef[];
  readonly optionalActivityRefs: readonly EntityRef[];
  readonly exampleRefs: readonly EntityRef[];
  readonly rewardGroupId: string;
}
export interface C6ChoiceCheck {
  readonly prompt: string;
  readonly options: readonly {
    readonly key: 'A' | 'B' | 'C' | 'D';
    readonly text: string;
    readonly explanation: string;
  }[];
  readonly answerKey: 'A' | 'B' | 'C' | 'D';
}
interface C6ActivityBase {
  readonly ref: EntityRef;
  readonly sourceNodeRef: EntityRef;
  readonly lessonRef: EntityRef;
  readonly learningRevision: 1;
  readonly goal: string;
  readonly knowledgeRef: EntityRef;
  readonly platformSupplement: true;
  readonly originalExercisePassClaim: false;
}
export type C6CourseActivity =
  | (C6ActivityBase & {
      readonly kind: 'concept-check';
      readonly mandatory: true;
      readonly check: C6ChoiceCheck;
    })
  | (C6ActivityBase & {
      readonly kind: 'source-design-check';
      readonly mandatory: false;
      readonly sourceQuestion: {
        readonly id: string;
        readonly kind: 'review' | 'programming';
        readonly locator: C6SourceLocator;
      };
      readonly discussion: string;
      readonly check: C6ChoiceCheck;
      readonly codingAssessment: {
        readonly scope: string;
        readonly design: string;
        readonly boundaries: readonly string[];
        readonly originalExercisePassClaim: false;
      } | null;
    })
  | (C6ActivityBase & {
      readonly kind: 'rust-execution';
      readonly mandatory: true;
      readonly exerciseRef: EntityRef;
      readonly judgeProfileRef: EntityRef;
    });
export interface C6RustVerification {
  readonly kind: 'rust-verified';
  readonly engineBuildSha256: string;
  readonly sourceSha256: string;
  readonly requestSha256: string;
  readonly resultSha256: string;
}
export type C6ExampleDiagnostic =
  | {
      readonly kind: 'rust-diagnostic';
      readonly code: 'E_PARSE_INVALID' | 'E_ARGUMENTS' | 'E_UNINITIALIZED' | 'E_POINTER_BOUNDS';
      readonly anchor: string;
    }
  | {
      readonly kind: 'semantic-output-mismatch';
      readonly businessExpectedStdout: string;
      readonly anchor: string;
      readonly correctedExpression: string;
    };
interface C6ExampleBase {
  readonly ref: EntityRef;
  readonly sourceExampleId: string;
  readonly sourceNodeRef: EntityRef;
  readonly lessonRef: EntityRef;
  readonly titleOriginal: string;
  readonly locator: C6SourceLocator;
  readonly source: string;
  readonly input: string;
  readonly expectedStdout: string | null;
  readonly expectedReturn: number | null;
  readonly explanation: string;
  readonly reviewFocus: string;
  readonly platformSupplement: true;
}
export type C6CourseExample =
  | (C6ExampleBase & {
      readonly mode: 'c6-independent-executable';
      readonly verification: C6RustVerification;
    })
  | (C6ExampleBase & {
      readonly mode: 'c6-diagnostic-demo';
      readonly verification: C6RustVerification;
      readonly expectedDiagnostic: C6ExampleDiagnostic;
    })
  | (C6ExampleBase & {
      readonly mode: 'reading-only';
      readonly reason: string;
      readonly readingBoundary: string;
      readonly verification: { readonly kind: 'reading-not-executed' };
      readonly sourceFileName?: string;
      readonly companionFiles?: readonly { readonly path: string; readonly source: string }[];
    });
export interface C6CourseExercise {
  readonly ref: EntityRef;
  readonly sourceNodeRef: EntityRef;
  readonly lessonRef: EntityRef;
  readonly profileRef: EntityRef;
  readonly programRef: EntityRef;
  readonly learningRevision: 1;
  readonly acceptedPriorVersions: readonly string[];
  readonly platformSupplement: true;
  readonly semanticTargets: readonly string[];
  readonly nodeSpecificRequirement: string;
  readonly tests: readonly {
    readonly caseKey: 'case-1' | 'case-2' | 'case-3' | 'case-4';
    readonly stdin: string;
    readonly expectedStdout: string;
    readonly expectedReturnCode: 0;
    readonly purpose: string;
    readonly observationRule: string;
  }[];
  readonly verification: {
    readonly referenceStatus: 'passed';
    readonly starterStatus: 'failed';
    readonly caseCount: 4;
    readonly reference: C6RustVerification;
    readonly starter: C6RustVerification;
  };
  readonly title: string;
  readonly prompt: string;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly starterSource: string;
  readonly referenceSource: string;
  readonly hints: readonly string[];
  readonly commonMistakes: readonly string[];
  readonly boundaryExplanation: string;
  readonly reviewFocus: string;
}
export interface C6KnowledgeNode {
  readonly ref: EntityRef;
  readonly sourceNodeRef: EntityRef;
  readonly kind: 'chapter' | 'lesson';
  readonly title: string;
  readonly chapterKnowledgeRef: EntityRef | null;
  readonly precision: 'lesson' | 'chapter-only-source-design';
}
export interface C6CourseCompatibility {
  readonly legacyMapSha256: string;
  readonly rewardMappingSha256: string;
  readonly legacyLinks: readonly {
    readonly kind: 'lesson' | 'exercise' | 'case' | 'supplemental-exercise';
    readonly fromRef: EntityRef;
    readonly targetRef: EntityRef;
    readonly relatedSourceNodeRef: EntityRef | null;
    readonly oldPackageRef: EntityRef | null;
    readonly language: 'c' | 'cpp' | null;
    readonly learningRevision: number | null;
    readonly acceptedPriorVersions: readonly string[];
    readonly transferPass: false;
  }[];
  readonly rewardGroups: readonly {
    readonly id: string;
    readonly lessonRefs: readonly EntityRef[];
    readonly exerciseRefs: readonly EntityRef[];
    readonly legacyLessonRef: EntityRef | null;
    readonly legacyExerciseRef: EntityRef | null;
    readonly lessonReward: {
      readonly points: 20;
      readonly subjectId: string;
      readonly sourceId: 'reward.lesson.first-completion';
    };
    readonly exerciseReward: {
      readonly points: 10;
      readonly subjectId: string;
      readonly sourceId: 'reward.exercise.first-pass';
    };
    readonly emptyNewGroupCanGrant: false;
  }[];
}
export interface C6CourseChunk {
  readonly contractVersion: '2.0.0';
  readonly packageRef: C6CourseManifest['packageRef'];
  readonly chunkId: C6ChunkId;
  readonly rootNodeId: string;
  readonly kind: C6ChunkKind;
  readonly nodes: readonly C6BodyNode[];
  readonly lessons: readonly C6CourseLesson[];
  readonly activities: readonly C6CourseActivity[];
  readonly examples: readonly C6CourseExample[];
  readonly exercises: readonly C6CourseExercise[];
  readonly knowledge: readonly C6KnowledgeNode[];
  readonly compatibility: C6CourseCompatibility | null;
}
