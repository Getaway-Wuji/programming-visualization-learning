export interface JavaRef {
  id: string;
  version: '1.0.0';
}

interface JavaIdentity {
  language: 'java';
  engineId: 'engine.rust.java';
  engineVersion: '0.1.0';
  javaReference: '21';
  execVersion: '1.7.0';
  dslVersion: '1.6.0';
  diagnosticVersion: '1.6.0';
  integerEncoding: '1.1.0';
  runId: string;
  sourceRevision: string;
  sourceSha256: string;
}

export type JavaOperation =
  | { kind: 'run'; input: { kind: 'stdin-utf8'; text: string } }
  | { kind: 'judge'; judgeVersion: '2.2.0'; packageRef: JavaRef; profileRef: JavaRef }
  | { kind: 'edit'; editVersion: '2.2.0'; packageRef: JavaRef; documentId: string };
export interface JavaRequest extends JavaIdentity {
  source: string;
  operation: JavaOperation;
}

export interface JavaRange {
  start: number;
  end: number;
}

export interface JavaNode {
  nodeId: number;
  byteRange: JavaRange;
  kind: string;
}

export interface JavaFault {
  code: string;
  byteRange: JavaRange;
  stage: string;
}

export type JavaValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number }
  | { kind: 'long'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; objectId: number };

export type JavaObject =
  | { kind: 'int-array' | 'string-array'; slots: JavaValue[] }
  | { kind: 'instance'; className: string; fields: Record<string, JavaValue> }
  | { kind: 'scanner' };

export interface JavaFrame {
  id: number;
  methodNodeId: number;
  callNodeId: number;
  bindings: Record<string, JavaValue>;
}

interface JavaControl {
  nodeId: number | null;
  path: number[];
  inputCursor: number;
}

interface JavaAllocator {
  objects: number;
  frames: number;
  liveBytes: number;
}

interface JavaCounters {
  writes: number;
  calls: number;
  comparisons: number;
}

export interface JavaState {
  frames: JavaFrame[];
  objects: Record<string, JavaObject>;
  control: JavaControl;
  allocator: JavaAllocator;
  counters: JavaCounters;
  output: string;
}

type Pair<T> = { before: T; after: T };
export type JavaChange =
  | ({ op: 'binding'; frameId: number; name: string } & Pair<JavaValue | null>)
  | ({ op: 'frame' } & Pair<JavaFrame | null>)
  | ({ op: 'object'; objectId: number } & Pair<JavaObject | null>)
  | ({ op: 'slot'; objectId: number; index: number } & Pair<JavaValue>)
  | ({ op: 'field'; objectId: number; name: string } & Pair<JavaValue>)
  | ({ op: 'control' } & Pair<JavaControl>)
  | ({ op: 'allocator' } & Pair<JavaAllocator>)
  | ({ op: 'counters' } & Pair<JavaCounters>)
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };

export interface JavaStep {
  seq: number;
  kind: string;
  nodeId: number;
  value: JavaValue | null;
  changes: JavaChange[];
}

export interface JavaTrace {
  completeness: 'complete' | 'prefix';
  initialState: JavaState;
  steps: JavaStep[];
  checkpoints: { cursor: number; state: JavaState }[];
}

export interface JavaPacket {
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    cursor: number;
    diagnostic: JavaFault | null;
  };
  trace: JavaTrace | null;
}

export interface JavaCase {
  caseKey: number;
  stdoutMatches: boolean;
  observationMatches: boolean;
  observations: { seq: number; nodeId: number; tag: 'print'; value: JavaValue }[];
  packet: JavaPacket;
}

export type JavaResult =
  | { kind: 'run'; packet: JavaPacket }
  | {
      kind: 'judge';
      judgeVersion: '2.2.0';
      packageRef: JavaRef;
      profileRef: JavaRef;
      status: 'passed' | 'failed' | 'incomplete';
      diagnostic: JavaFault | null;
      cases: JavaCase[];
    }
  | {
      kind: 'edit';
      editVersion: '2.2.0';
      packageRef: JavaRef;
      documentId: string;
      status: 'mapped' | 'code-only' | 'invalid' | 'unsupported';
      diagnostic: JavaFault | null;
      blockMap: JavaNode[];
    };

export interface JavaResponse extends JavaIdentity {
  engineBuildSha256: string;
  nodeMap: JavaNode[];
  result: JavaResult;
  usage: { steps: number; objects: number; outputBytes: number; resultBytes: number };
  fuel: number;
}
