// Synthetic protocol-only fixture. Real Rust proof lives in algorithm-engine.spec.ts.
import type {
  AlgorithmRequest,
  AlgorithmResult,
  AlgorithmState,
  AlgorithmStep,
} from '../../web/src/engine/algorithm-protocol';

export const request: AlgorithmRequest = {
  execVersion: '1.2.0',
  dslVersion: '1.1.0',
  diagnosticVersion: '1.1.0',
  integerEncoding: '1.0.0',
  language: 'c',
  engineId: 'engine.rust.p1',
  runId: 'fixture-run',
  sourceRevision: 'fixture-revision',
  source: 'int main(){int x=7; return x;}',
  input: [],
};
export function fixture(buildId = 'f'.repeat(64)): AlgorithmResult {
  const initial: AlgorithmState = {
    frames: [],
    scopes: [],
    objects: [],
    output: '',
    control: { activeFrameId: null, nextNodeId: 'n1', returnValue: null, inputCursor: 0 },
    allocator: { nextAddress: 4096, liveBytes: 0, nextObject: 1, nextScope: 1, nextFrame: 1 },
    counters: { comparisons: 0, scalarWrites: 0, arrayWrites: 0, swaps: 0 },
  };
  const frame = {
    id: 'f1',
    functionNodeId: 'n1',
    functionName: 'main',
    parentFrameId: null,
    callNodeId: null,
    scopeIds: ['s1'],
  };
  const scope = { id: 's1', frameId: 'f1', nodeId: 'n2', objectIds: ['o1'], aliases: [] };
  const emptyScope = { ...scope, objectIds: [] };
  const object = {
    id: 'o1',
    declarationNodeId: 'n3',
    frameId: 'f1',
    scopeId: 's1',
    name: 'x',
    kind: 'int' as const,
    length: 1,
    baseAddress: 4096,
    defaultValue: null,
    cells: [],
  };
  const enteredControl = { ...initial.control, activeFrameId: 'f1', nextNodeId: 'n3' };
  const enteredAllocator = { ...initial.allocator, nextFrame: 2, nextScope: 2 };
  const allocated = { ...enteredAllocator, nextAddress: 4100, nextObject: 2, liveBytes: 4 };
  const steps: AlgorithmStep[] = [
    {
      seq: 1,
      kind: 'program.enter',
      nodeId: 'n1',
      changes: [
        { op: 'record', table: 'frames', id: 'f1', index: 0, before: null, after: frame },
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: null, after: emptyScope },
        { op: 'control', before: initial.control, after: enteredControl },
        { op: 'allocator', before: initial.allocator, after: enteredAllocator },
      ],
    },
    {
      seq: 2,
      kind: 'object.declare',
      nodeId: 'n3',
      changes: [
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: emptyScope, after: scope },
        { op: 'record', table: 'objects', id: 'o1', index: 0, before: null, after: object },
        { op: 'allocator', before: enteredAllocator, after: allocated },
      ],
    },
    {
      seq: 3,
      kind: 'value.initialize',
      nodeId: 'n3',
      changes: [
        { op: 'cell', objectId: 'o1', index: 0, before: null, after: 7 },
        {
          op: 'counters',
          before: initial.counters,
          after: { ...initial.counters, scalarWrites: 1 },
        },
      ],
    },
    {
      seq: 4,
      kind: 'program.return',
      nodeId: 'n4',
      changes: [
        {
          op: 'record',
          table: 'objects',
          id: 'o1',
          index: 0,
          before: { ...object, cells: [{ index: 0, value: 7 }] },
          after: null,
        },
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: scope, after: null },
        { op: 'record', table: 'frames', id: 'f1', index: 0, before: frame, after: null },
        {
          op: 'control',
          before: enteredControl,
          after: { ...initial.control, nextNodeId: null, returnValue: 7 },
        },
        { op: 'allocator', before: allocated, after: { ...allocated, liveBytes: 0 } },
      ],
    },
  ];
  return {
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
    integerEncoding: '1.0.0',
    language: 'c',
    engine: { id: 'engine.rust.p1', version: '0.1.0', buildId },
    identity: { runId: request.runId, sourceRevision: request.sourceRevision },
    nodeMap: [
      { nodeId: 'n1', kind: 'function', byteRange: { start: 0, end: request.source.length } },
      { nodeId: 'n2', kind: 'block', byteRange: { start: 10, end: request.source.length } },
      { nodeId: 'n3', kind: 'declaration', byteRange: { start: 11, end: 19 } },
      { nodeId: 'n4', kind: 'return', byteRange: { start: 20, end: 29 } },
    ],
    trace: {
      dslVersion: '1.1.0',
      completeness: 'complete',
      initialState: initial,
      steps,
      checkpoints: [{ cursor: 0, state: structuredClone(initial) }],
    },
    terminal: { status: 'completed', code: null, byteRange: null, cursor: 4, returnValue: 7 },
    stats: { fuelUsed: 100 },
  };
}
