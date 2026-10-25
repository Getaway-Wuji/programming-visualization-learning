export interface EntityRef {
  readonly id: string;
  readonly version: string;
}
export interface ContentEntity extends EntityRef {
  readonly title: string;
}
export interface LanguageEntity extends ContentEntity {
  readonly execution: 'subset' | 'reserved';
  readonly subsetRefs: readonly EntityRef[];
}
export interface LanguageOwned extends ContentEntity {
  readonly languageRef: EntityRef;
}
export interface LearningEntity extends LanguageOwned {
  readonly learningRevision: number;
  readonly acceptedPriorVersions: readonly string[];
}
export interface SourceReference {
  readonly document: string;
  readonly locator: string;
}
export interface Teaching {
  readonly objectives: readonly string[];
  readonly explanation: string;
  readonly exampleProgramRefs: readonly EntityRef[];
  readonly commonMistakes: readonly string[];
  readonly boundaryNotes: readonly string[];
  readonly source: SourceReference;
}
export interface SubsetEntity extends LanguageOwned {
  readonly decision: 'P0-C V1.0';
  readonly capabilityIds: readonly string[];
}
export interface ChapterEntity extends LanguageOwned {
  readonly order: number;
  readonly lessonRefs: readonly EntityRef[];
}
export interface LessonEntity extends LearningEntity {
  readonly chapterRef: EntityRef;
  readonly knowledgeRefs: readonly EntityRef[];
  readonly requiredExerciseRefs: readonly EntityRef[];
  readonly optionalExerciseRefs: readonly EntityRef[];
  readonly caseRefs: readonly EntityRef[];
  readonly blockRefs: readonly EntityRef[];
  readonly teaching: Teaching;
  readonly rewardRef: EntityRef;
}
export interface KnowledgeEntity extends LanguageOwned {
  readonly prerequisiteRefs: readonly EntityRef[];
}
export interface InputField {
  readonly key: string;
  readonly kind: 'integer' | 'sequence';
  readonly min: number;
  readonly max: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}
export interface InputRelation {
  readonly kind: 'length-of' | 'index-in' | 'nondecreasing';
  readonly field: string;
  readonly target?: string;
}
export interface InputSpecEntity extends ContentEntity {
  readonly fields: readonly InputField[];
  readonly relations: readonly InputRelation[];
}
export type InputValues = Readonly<Record<string, number | readonly number[]>>;
export interface InputBinding {
  readonly bindingKey: string;
  readonly inputKey: string;
  readonly targetName: string;
  readonly targetKind: 'scalar' | 'array' | 'logical-length';
  readonly from: 'field' | 'length-of';
  readonly emptyStorage?: 'one-zero-placeholder';
}
export interface ProgramEntity extends LanguageOwned {
  readonly subsetRef: EntityRef;
  readonly inputRef: EntityRef;
  readonly exampleInput: InputValues;
  readonly sourceExample: string;
  readonly bindings: readonly InputBinding[];
  readonly blockRefs: readonly EntityRef[];
  readonly reference: SourceReference;
}
export type JudgeRule =
  | 'input-read-output'
  | 'multiply-add-output'
  | 'if-else-paths'
  | 'while-for-accumulations'
  | 'single-index-increment'
  | 'logical-array-accumulation';
export interface JudgeProfileEntity extends ContentEntity {
  readonly rule: JudgeRule;
  readonly targetDescription: string;
}
export interface ExerciseTest {
  readonly caseKey: string;
  readonly input: InputValues;
  readonly expectedStdout: string;
  readonly expectedExitCode: 0;
  readonly expectedArray?: readonly number[];
}
export interface ExerciseEntity extends LearningEntity {
  readonly lessonRef: EntityRef;
  readonly knowledgeRefs: readonly EntityRef[];
  readonly programRef: EntityRef;
  readonly judgeRef: EntityRef;
  readonly prompt: string;
  readonly tests: readonly ExerciseTest[];
  readonly rewardRef: EntityRef;
}
export type ResultRule =
  | 'assignment-add-two'
  | 'nonnegative-branch'
  | 'two-loop-sums'
  | 'logical-array-sum'
  | 'bubble-ascending'
  | 'selection-ascending'
  | 'binary-first-index';
export interface CaseEntity extends LearningEntity {
  readonly kind: 'demo' | 'algorithm';
  readonly knowledgeRefs: readonly EntityRef[];
  readonly relatedLessonRefs: readonly EntityRef[];
  readonly programRef: EntityRef;
  readonly teaching: Teaching;
  readonly resultRule: ResultRule;
  readonly rewardRef: EntityRef;
}
export interface BlockEntity extends LanguageOwned {
  readonly subsetRef: EntityRef;
  readonly connectionType: 'program' | 'statement' | 'int-expression';
  readonly slotTypes: readonly string[];
  readonly operators: readonly string[];
  readonly capabilityIds: readonly string[];
}
export interface RewardSourceEntity extends ContentEntity {
  readonly eventType:
    'exercise.passed' | 'lesson.completed' | 'case.view-confirmed' | 'daily-goal.achieved';
  readonly scope: 'content-id' | 'local-day';
  readonly repeat: 'first-only' | 'once-per-day';
  readonly pointsOwner: '11.1';
}
export interface ContentPackage {
  readonly contractVersion: '1.0.0';
  readonly packageId: 'content.c.p0';
  readonly packageVersion: '1.0.0';
  readonly purpose: 'contract-fixture';
  readonly phase: 'P0';
  readonly languages: readonly LanguageEntity[];
  readonly subsets: readonly SubsetEntity[];
  readonly chapters: readonly ChapterEntity[];
  readonly lessons: readonly LessonEntity[];
  readonly knowledgePoints: readonly KnowledgeEntity[];
  readonly inputSpecs: readonly InputSpecEntity[];
  readonly programs: readonly ProgramEntity[];
  readonly judgeProfiles: readonly JudgeProfileEntity[];
  readonly exercises: readonly ExerciseEntity[];
  readonly cases: readonly CaseEntity[];
  readonly blocks: readonly BlockEntity[];
  readonly rewardSources: readonly RewardSourceEntity[];
}
export interface ContentDiagnostic {
  readonly code: string;
  readonly severity: 'error';
  readonly path: string;
  readonly relatedId?: string;
  readonly expected?: string | number;
  readonly actual?: string | number;
}
