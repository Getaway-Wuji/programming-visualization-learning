/** Independent EXEC1.5/STEP1.4 types. Old engine schemas remain unchanged. */
export interface C6Ref {
  id: string;
  version: string;
}
export interface C6RunRequest {
  execVersion: '1.5.0';
  dslVersion: '1.4.0';
  diagnosticVersion: '1.4.0';
  integerEncoding: '1.0.0';
  language: 'c';
  engineId: 'engine.rust.c6';
  engineVersion: '0.1.0';
  runId: string;
  sourceRevision: string;
  sourceSha256: string;
  source: string;
  input: { kind: 'stdin-ascii'; text: string };
}
export interface C6JudgeRequest extends Omit<C6RunRequest, 'input'> {
  judgeVersion: '2.0.0';
  profileRef: C6Ref;
  packageRef: { id: 'content.c.primer6'; version: '1.0.0' };
}
export interface C6EditRequest {
  editVersion: '2.0.0';
  documentId: string;
  packageRef: { id: 'content.c.primer6'; version: '1.0.0' };
  engine: { id: 'engine.rust.c6'; version: '0.1.0' };
  sourceRevision: string;
  sourceSha256: string;
  source: string;
}
export type C6Request = C6RunRequest | C6JudgeRequest | C6EditRequest;
export interface C6Pointer {
  objectId: string | null;
  byteOffset: number;
  lowerBound: number;
  upperBound: number;
  pointeeType: string;
}
export type C6Value = null | number | C6Pointer | { kind: 'f32' | 'f64'; bits: string };
export interface C6Type {
  name: string;
  kind: 'int' | 'uint' | 'char' | 'f32' | 'f64' | 'pointer' | 'array' | 'struct' | 'void';
  byteSize: number;
  alignment: 1 | 4 | 8;
  pointeeType: string | null;
  elementType: string | null;
  elementCount: number;
  fields: { name: string; typeName: string; byteOffset: number }[];
}
export interface C6Node {
  nodeId: string;
  kind: string;
  byteRange: { start: number; end: number };
}
export interface C6Frame {
  id: string;
  functionNodeId: string;
  functionName: string;
  parentFrameId: string | null;
  callNodeId: string | null;
  scopeIds: string[];
}
export interface C6Scope {
  id: string;
  frameId: string | null;
  nodeId: string;
  objectIds: string[];
  aliases: { name: string; objectId: string }[];
}
export interface C6Object {
  id: string;
  declarationNodeId: string;
  frameId: string | null;
  scopeId: string | null;
  name: string;
  typeName: string;
  length: number;
  byteLength: number;
  baseAddress: number;
  storage: 'automatic' | 'static' | 'literal';
  alive: boolean;
  zeroInitialized: boolean;
  writable: boolean;
  cells: { byteOffset: number; value: C6Value }[];
}
export interface C6State {
  frames: C6Frame[];
  scopes: C6Scope[];
  objects: C6Object[];
  control: {
    activeFrameId: string | null;
    nextNodeId: string | null;
    returnValue: C6Value;
    inputCursor: number;
  };
  allocator: {
    nextAddress: number;
    liveBytes: number;
    nextObject: number;
    nextScope: number;
    nextFrame: number;
  };
  output: string;
  counters: { comparisons: number; scalarWrites: number; arrayWrites: number; swaps: number };
}
export type C6Change =
  | {
      op: 'record';
      table: 'frames' | 'scopes' | 'objects';
      id: string;
      index: number;
      before: C6Frame | C6Scope | C6Object | null;
      after: C6Frame | C6Scope | C6Object | null;
    }
  | { op: 'cell'; objectId: string; byteOffset: number; before: C6Value; after: C6Value }
  | { op: 'control'; before: C6State['control']; after: C6State['control'] }
  | { op: 'allocator'; before: C6State['allocator']; after: C6State['allocator'] }
  | { op: 'counters'; before: C6State['counters']; after: C6State['counters'] }
  | { op: 'output'; beforeBytes: number; afterBytes: number; append: string };
export interface C6Step {
  seq: number;
  kind: string;
  nodeId: string;
  changes: C6Change[];
}
export interface C6Trace {
  dslVersion: '1.4.0';
  completeness: 'complete' | 'prefix';
  initialState: C6State;
  steps: C6Step[];
  checkpoints: { cursor: number; state: C6State }[];
}
export interface C6Result {
  execVersion: '1.5.0';
  dslVersion: '1.4.0';
  diagnosticVersion: '1.4.0';
  integerEncoding: '1.0.0';
  language: 'c';
  engine: { id: 'engine.rust.c6'; version: '0.1.0'; buildId: string };
  identity: { runId: string; sourceRevision: string; sourceSha256: string };
  types: C6Type[];
  nodeMap: C6Node[];
  trace: C6Trace | null;
  terminal: {
    status: 'completed' | 'error' | 'limited' | 'cancelled';
    code: string | null;
    byteRange: { start: number; end: number } | null;
    cursor: number;
    returnValue: C6Value;
  };
  stats: { fuelUsed: number };
}
export interface C6Observation {
  tag: string;
  nodeId: string;
  seq: number;
  objectIds: string[];
  value: C6Value;
}
export interface C6JudgeResult {
  judgeVersion: '2.0.0';
  packageRef: C6Ref;
  profileRef: C6Ref;
  sourceSha256: string;
  status: 'passed' | 'failed' | 'incomplete';
  cases: {
    caseKey: string;
    packet: C6Result;
    stdoutMatches: boolean;
    returnMatches: boolean;
    observationMatches: boolean;
    observations: C6Observation[];
  }[];
  aggregate: {
    elapsedMs: number;
    fuel: number;
    steps: number;
    objects: number;
    outputBytes: number;
    resultBytes: number;
    wasmPeakBytes: number;
  };
}
export interface C6EditResult extends Omit<C6EditRequest, 'engine'> {
  engine: C6EditRequest['engine'] & { buildId: string };
  status: 'mapped' | 'code-only' | 'invalid' | 'unsupported';
  nodeMap: C6Node[];
  program: { rootId: string; nodes: Record<string, unknown>[] } | null;
  blockMap: { blockId: string; nodeId: string; byteRange: { start: number; end: number } }[];
  diagnostics: { code: string; byteRange: { start: number; end: number } }[];
  profileRef: C6Ref;
}
export type C6Response = C6Result | C6JudgeResult | C6EditResult;
