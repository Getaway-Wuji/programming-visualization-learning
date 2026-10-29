import type { ByteRange, Diagnostic, ExecuteRequest, Ref } from '../engine/protocol';
import type { PreparedSource } from '../engine/execution-client';
import type { BlockProgram } from './model';

export interface AnalysisIdentity {
  contextId: string;
  contextRevision: number;
  documentRevision: number;
  editId: string;
  operationId: string;
}
export interface AnalysisRefs {
  packageRef: Ref;
  programRef: Ref;
  subsetRef: Ref;
}
export interface AnalysisRequest {
  kind: 'analysisRequest';
  analysisVersion: '1.0.0';
  identity: AnalysisIdentity;
  refs: AnalysisRefs;
  sourceText: string;
  input: ExecuteRequest['input'];
}
interface AstBase {
  nodeId: string;
  parentId: string | null;
  byteRange: ByteRange;
}
export type AstInitializer =
  { kind: 'none' } | { kind: 'scalar'; expression: string } | { kind: 'array'; elements: string[] };
export type AnalysisNode = AstBase &
  (
    | { kind: 'function'; body: string }
    | { kind: 'block'; statements: string[] }
    | {
        kind: 'declaration';
        name: string;
        nameRange: ByteRange;
        arrayLength: string | null;
        initializer: AstInitializer;
      }
    | { kind: 'assignment'; target: string; value: string }
    | { kind: 'if'; condition: string; thenBlock: string; elseBlock: string | null }
    | { kind: 'while'; condition: string; body: string }
    | {
        kind: 'for';
        init: string | null;
        condition: string | null;
        update: string | null;
        body: string;
      }
    | { kind: 'condition'; expression: string }
    | { kind: 'output'; format: string; formatRange: ByteRange; arguments: string[] }
    | { kind: 'return'; value: string }
    | { kind: 'break' | 'continue' | 'empty' }
    | { kind: 'integer'; value: string }
    | { kind: 'name'; name: string; resolvedDeclarationId: string }
    | { kind: 'index'; array: string; index: string }
    | { kind: 'unary'; operator: '+' | '-' | '!'; operand: string }
    | {
        kind: 'binary';
        operator: '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';
        left: string;
        right: string;
      }
  );
export interface CheckedAst {
  rootId: string;
  headerRange: ByteRange | null;
  nodes: AnalysisNode[];
}
export interface AnalysisTrivia {
  kind: 'line-comment' | 'block-comment' | 'whitespace';
  byteRange: ByteRange;
}
interface AnalysisBase {
  analysisVersion: '1.0.0';
  identity: AnalysisIdentity;
  refs: AnalysisRefs;
}
export interface ValidAnalysisResult extends AnalysisBase {
  kind: 'analysisResult';
  status: 'valid';
  checkedAst: CheckedAst;
  bindingMap: PreparedSource['bindingMap'];
  nodeMap: {
    nodeId: string;
    kind: string;
    parentId: string | null;
    byteRange: ByteRange;
  }[];
  blockMap: PreparedSource['blockMap'];
  trivia: AnalysisTrivia[];
  diagnostics: Diagnostic[];
}
export interface InvalidAnalysisResult extends AnalysisBase {
  kind: 'analysisResult';
  status: 'invalid';
  diagnostics: Diagnostic[];
}
export type AnalysisFailureCode =
  'module' | 'transport' | 'cancelled' | 'budget' | 'response' | 'version';
export interface AnalysisFailure extends AnalysisBase {
  kind: 'analysisFailure';
  error: { code: AnalysisFailureCode };
}
export type AnalysisResult = ValidAnalysisResult | InvalidAnalysisResult | AnalysisFailure;
export interface SyntheticSegment {
  kind: 'synthetic-tail-return';
  nodeId: string;
  byteRange: ByteRange;
}
export interface SourceProvenance {
  documentRevision: number;
  generationMode: 'canonical' | 'preserve';
  trivia: AnalysisTrivia[];
  syntheticSegments: SyntheticSegment[];
}
export interface MappingIssue {
  reason:
    | 'EMPTY_STATEMENT'
    | 'FOR_ARRAY_TARGET'
    | 'BLOCK_NAME'
    | 'BLOCK_FORMAT'
    | 'BLOCK_STRUCTURE'
    | 'INPUT_BINDING'
    | 'UNSUPPORTED_RANGE';
  nodeId: string | null;
  blockId: string | null;
  byteRange: ByteRange | null;
}
export interface ReverseProjection {
  documentRevision: number;
  sourceText: string;
  program: BlockProgram;
  source: PreparedSource;
  provenance: SourceProvenance;
  analysis: ValidAnalysisResult;
  issues: MappingIssue[];
}
