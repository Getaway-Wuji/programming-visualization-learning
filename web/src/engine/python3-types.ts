export interface PythonRef {
  id: string;
  version: '1.0.0';
}
interface PythonIdentity {
  language: 'python';
  engineId: 'engine.rust.python3';
  engineVersion: '0.1.0';
  pythonReference: '3.13';
  execVersion: '1.6.0';
  dslVersion: '1.5.0';
  diagnosticVersion: '1.5.0';
  integerEncoding: '1.0.0';
  runId: string;
  sourceRevision: string;
  sourceSha256: string;
}
export type PythonOperation =
  | { kind: 'run'; input: { kind: 'stdin-utf8'; text: string } }
  | { kind: 'judge'; judgeVersion: '2.1.0'; packageRef: PythonRef; profileRef: PythonRef }
  | { kind: 'edit'; editVersion: '2.1.0'; packageRef: PythonRef; documentId: string };
export interface PythonRequest extends PythonIdentity {
  source: string;
  operation: PythonOperation;
}
export interface PythonRange {
  start: number;
  end: number;
}
export interface PythonNode {
  nodeId: number;
  byteRange: PythonRange;
  kind: string;
}
export interface PythonFault {
  code: string;
  byteRange: PythonRange;
  stage: string;
}
export type PythonValue =
  | { kind: 'none' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number }
  | { kind: 'f64'; bits: string }
  | { kind: 'str'; value: string }
  | { kind: 'list-ref'; objectId: number }
  | { kind: 'function-ref'; nodeId: number }
  | { kind: 'builtin-ref'; name: string };
export interface PythonFrame {
  id: number;
  functionNodeId: number;
  callNodeId: number;
  bindings: Record<string, PythonValue>;
}
export interface PythonControl {
  nodeId: number | null;
  pending: number[];
  inputCursor: number;
  iterations: {
    nodeId: number;
    frameId: number;
    index: number;
    current: number | null;
    stop: number | null;
    stride: number | null;
  }[];
}
export interface PythonAllocator {
  nextObject: number;
  nextFrame: number;
  liveBytes: number;
}
export interface PythonCounters {
  assignments: number;
  listWrites: number;
  comparisons: number;
  calls: number;
}
export interface PythonState {
  globals: Record<string, PythonValue>;
  frames: PythonFrame[];
  objects: Record<string, PythonValue[]>;
  control: PythonControl;
  allocator: PythonAllocator;
  counters: PythonCounters;
  output: string;
}
type Pair<T> = { before: T; after: T };
export type PythonChange =
  | ({ op: 'binding'; frameId: number; name: string } & Pair<PythonValue | null>)
  | ({ op: 'object'; objectId: number } & Pair<PythonValue[] | null>)
  | ({
      op: 'slot';
      objectId: number;
      index: number;
      beforeLen: number;
      afterLen: number;
    } & Pair<PythonValue | null>)
  | ({ op: 'frame' } & Pair<PythonFrame | null>)
  | ({ op: 'control' } & Pair<PythonControl>)
  | ({ op: 'allocator' } & Pair<PythonAllocator>)
  | ({ op: 'counters' } & Pair<PythonCounters>)
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export interface PythonStep {
  seq: number;
  kind: string;
  nodeId: number;
  value: PythonValue | null;
  changes: PythonChange[];
}
export interface PythonTrace {
  completeness: 'complete' | 'prefix';
  initialState: PythonState;
  steps: PythonStep[];
  checkpoints: { cursor: number; state: PythonState }[];
}
export interface PythonPacket {
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    cursor: number;
    diagnostic: PythonFault | null;
  };
  trace: PythonTrace | null;
}
export interface PythonCase {
  caseKey: number;
  stdoutMatches: boolean;
  observationMatches: boolean;
  observations: { seq: number; nodeId: number; tag: string; value: PythonValue | null }[];
  packet: PythonPacket;
}
export type PythonResult =
  | { kind: 'run'; packet: PythonPacket }
  | {
      kind: 'judge';
      judgeVersion: '2.1.0';
      packageRef: PythonRef;
      profileRef: PythonRef;
      status: 'passed' | 'failed' | 'incomplete';
      diagnostic: PythonFault | null;
      cases: PythonCase[];
    }
  | {
      kind: 'edit';
      editVersion: '2.1.0';
      packageRef: PythonRef;
      documentId: string;
      status: 'mapped' | 'code-only' | 'invalid' | 'unsupported';
      diagnostic: PythonFault | null;
      blockMap: PythonNode[];
    };
export interface PythonResponse extends PythonIdentity {
  engineBuildSha256: string;
  nodeMap: PythonNode[];
  result: PythonResult;
  usage: { steps: number; objects: number; outputBytes: number; resultBytes: number };
  fuel: number;
}
