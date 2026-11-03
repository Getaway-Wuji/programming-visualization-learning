import type { EntityRef } from './types';
import type {
  C6BodyNode,
  C6ChunkId,
  C6ChunkKind,
  C6CourseActivity,
  C6CourseCompatibility,
  C6CourseExample,
  C6CourseExercise,
  C6KnowledgeNode,
  C6NavigationNode,
} from './c6-course-types';

export type C6TeachingChunkId = C6ChunkId;
export interface C6TeachingRef {
  readonly id: string;
  readonly version: '2.0.0';
}
export interface C6TeachingProof {
  readonly kind: 'rust-verified';
  readonly engineBuildSha256: string;
  readonly sourceSha256: string;
  readonly bundleSha256: string;
  readonly inputSha256: string;
  readonly requestSha256: string;
  readonly resultSha256: string;
}
export interface C6TeachingRun {
  readonly input: string;
  readonly expectedStdout: string;
  readonly expectedReturn: number;
  readonly verification: C6TeachingProof;
}
interface ProgramBase {
  readonly ref: C6TeachingRef;
  readonly title: string;
  readonly files: readonly { readonly name: string; readonly source: string }[];
}
export type C6TeachingProgram =
  | (ProgramBase & {
      readonly mode: 'reading';
      readonly boundary: string;
      readonly prediction: string;
      readonly verification: { readonly kind: 'reading-not-executed' };
    })
  | (ProgramBase &
      C6TeachingRun & {
        readonly mode: 'execute';
        readonly additionalRuns: readonly C6TeachingRun[];
      })
  | (ProgramBase &
      Omit<C6TeachingRun, 'expectedReturn'> & {
        readonly mode: 'diagnostic';
        readonly expectedReturn: null;
        readonly expectedCode: string;
        readonly diagnosticExplanation: string;
        readonly additionalRuns: readonly (Omit<C6TeachingRun, 'expectedReturn'> & {
          readonly expectedReturn: null;
          readonly expectedCode: string;
        })[];
      })
  | (ProgramBase &
      C6TeachingRun & {
        readonly mode: 'diagnostic';
        readonly expectedCode: null;
        readonly businessExpectedStdout: string;
        readonly diagnosticExplanation: string;
        readonly additionalRuns: readonly [];
      });
type OldDesign = Extract<C6CourseActivity, { readonly kind: 'source-design-check' }>;
export type C6TeachingActivity =
  | (Omit<OldDesign, 'kind' | 'check'> & { readonly kind: 'source-design-guide' })
  | Extract<C6CourseActivity, { readonly kind: 'rust-execution' }>;
export type C6TeachingNode = C6BodyNode & {
  readonly programRefs: readonly C6TeachingRef[];
};
export interface C6TeachingLesson {
  readonly ref: C6TeachingRef;
  readonly sourceNodeRef: C6TeachingRef;
  readonly chapterRef: C6TeachingRef;
  readonly knowledgeRefs: readonly C6TeachingRef[];
  readonly mandatory: true;
  readonly learningRevision: 1;
  readonly acceptedPriorVersions: readonly [];
  readonly requiredActivityRefs: readonly C6TeachingRef[];
  readonly optionalActivityRefs: readonly C6TeachingRef[];
  readonly exampleRefs: readonly C6TeachingRef[];
  readonly programRefs: readonly C6TeachingRef[];
  readonly rewardGroupId: string;
  readonly completion: {
    readonly reading: 'explicit-confirmation';
    readonly execution: 'all-bound-judge-groups';
  };
}
export interface C6TeachingCounts {
  readonly nodes: 650;
  readonly lessons: 404;
  readonly teachingBodies: 505;
  readonly teachingProgramSlots: 576;
  readonly teachingPrograms: 386;
  readonly concepts: 0;
  readonly requiredLessons: 404;
  readonly directoryContainers: 112;
  readonly exerciseGroupContainers: 34;
  readonly referenceNodes: 111;
  readonly activities: 389;
  readonly requiredActivities: 44;
  readonly optionalActivities: 345;
  readonly sourceReviewGuides: 177;
  readonly sourceProgrammingGuides: 168;
  readonly executionExercises: 44;
  readonly judgeGroups: 176;
  readonly examples: 232;
  readonly executableExamples: 124;
  readonly diagnosticExamples: 7;
  readonly readingExamples: 101;
  readonly knowledgeNodes: 421;
  readonly lazyChunks: 19;
}
export interface C6TeachingChunk {
  readonly contractVersion: '3.0.0';
  readonly packageRef: { readonly id: 'content.c.primer6'; readonly version: '2.0.0' };
  readonly chunkId: C6TeachingChunkId;
  readonly rootNodeId: string;
  readonly kind: C6ChunkKind;
  readonly nodes: readonly C6TeachingNode[];
  readonly lessons: readonly C6TeachingLesson[];
  readonly activities: readonly C6TeachingActivity[];
  readonly examples: readonly C6CourseExample[];
  readonly exercises: readonly C6CourseExercise[];
  readonly knowledge: readonly C6KnowledgeNode[];
  readonly programs: readonly C6TeachingProgram[];
  readonly compatibility: C6CourseCompatibility | null;
}
export type C6TeachingEntityKind =
  'lessons' | 'activities' | 'examples' | 'exercises' | 'knowledge' | 'programs';
export interface C6TeachingMetadata {
  readonly contractVersion: '3.0.0';
  readonly packageRef: C6TeachingChunk['packageRef'];
  readonly languageRef: { readonly id: 'lang.c'; readonly version: '1.0.0' };
  readonly engineRef: { readonly id: 'engine.rust.c6'; readonly version: '0.1.0' };
  readonly engineBuildSha256: string;
  readonly judgeOwnerPackageRef: { readonly id: 'content.c.primer6'; readonly version: '1.0.0' };
  readonly judgeContractVersion: '2.0.0';
  readonly scopeRevision: 'user-20261102-full-key-teaching';
  readonly source: {
    readonly id: 'source.c.primer6';
    readonly edition: 6;
    readonly sha256: string;
  };
}
export interface C6TeachingManifest extends C6TeachingMetadata {
  readonly sourceSha256: string;
  readonly counts: C6TeachingCounts;
  readonly budgets: {
    readonly packageBytes: 20971520;
    readonly manifestBytes: 262144;
    readonly chunkBytes: 1048576;
    readonly sourceBytes: 32768;
  };
  readonly compatibilityChunkId: 'chA';
  readonly chunks: readonly {
    readonly id: C6TeachingChunkId;
    readonly kind: C6ChunkKind;
    readonly rootNodeId: string;
    readonly file: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly counts: Readonly<Record<'nodes' | C6TeachingEntityKind, number>>;
    readonly entityIds: Readonly<Record<C6TeachingEntityKind, readonly string[]>>;
  }[];
  readonly nodes: readonly C6NavigationNode[];
}
export interface C6TeachingSource extends C6TeachingMetadata {
  readonly chapters: readonly C6TeachingChunk[];
}
export type C6TeachingEntity =
  | C6TeachingNode
  | C6TeachingLesson
  | C6TeachingActivity
  | C6CourseExample
  | C6CourseExercise
  | C6KnowledgeNode
  | C6TeachingProgram;
export type C6TeachingLookup = { readonly ref: EntityRef; readonly kind: C6TeachingEntityKind };
