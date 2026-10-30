// Synthetic protocol-only fixture. Real Rust proof lives in memory-engine.spec.ts.
import type {
  MemoryRequest,
  MemoryObject,
  MemoryResult,
  MemoryState,
  MemoryStep,
} from '../../web/src/engine/memory-protocol';

export const request: MemoryRequest = {
  execVersion: '1.3.0',
  dslVersion: '1.2.0',
  diagnosticVersion: '1.2.0',
  integerEncoding: '1.0.0',
  language: 'c',
  engineId: 'engine.rust.memory',
  runId: 'fixture-run',
  sourceRevision: 'fixture-revision',
  source: 'int main(){int x=7; return x;}',
  input: [],
};
export function fixture(buildId = 'f'.repeat(64)): MemoryResult {
  const initial: MemoryState = {
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
  const object: MemoryObject = {
    id: 'o1',
    declarationNodeId: 'n3',
    frameId: 'f1',
    scopeId: 's1',
    name: 'x',
    typeName: 'int',
    length: 1,
    byteLength: 4,
    baseAddress: 4096,
    storage: 'automatic',
    alive: true,
    zeroInitialized: false,
    cells: [],
  };
  const enteredControl = { ...initial.control, activeFrameId: 'f1', nextNodeId: 'n3' };
  const enteredAllocator = { ...initial.allocator, nextFrame: 2, nextScope: 2 };
  const allocated = { ...enteredAllocator, nextAddress: 4100, nextObject: 2, liveBytes: 4 };
  const steps: MemoryStep[] = [
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
        { op: 'cell', objectId: 'o1', byteOffset: 0, before: null, after: 7 },
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
          before: { ...object, cells: [{ byteOffset: 0, value: 7 }] },
          after: { ...object, alive: false },
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
    execVersion: '1.3.0',
    dslVersion: '1.2.0',
    diagnosticVersion: '1.2.0',
    integerEncoding: '1.0.0',
    language: 'c',
    engine: { id: 'engine.rust.memory', version: '0.1.0', buildId },
    identity: { runId: request.runId, sourceRevision: request.sourceRevision },
    nodeMap: [
      { nodeId: 'n1', kind: 'function', byteRange: { start: 0, end: request.source.length } },
      { nodeId: 'n2', kind: 'block', byteRange: { start: 10, end: request.source.length } },
      { nodeId: 'n3', kind: 'declaration', byteRange: { start: 11, end: 19 } },
      { nodeId: 'n4', kind: 'return', byteRange: { start: 20, end: 29 } },
    ],
    types: [
      { name: 'int', kind: 'int', byteSize: 4, pointeeType: null, fields: [] },
      { name: 'int*', kind: 'pointer', byteSize: 8, pointeeType: 'int', fields: [] },
    ],
    trace: {
      dslVersion: '1.2.0',
      completeness: 'complete',
      initialState: initial,
      steps,
      checkpoints: [{ cursor: 0, state: structuredClone(initial) }],
    },
    terminal: { status: 'completed', code: null, byteRange: null, cursor: 4, returnValue: 7 },
    stats: { fuelUsed: 100 },
  };
}

export const pointerRequest: MemoryRequest = {
  ...request,
  language: 'cpp',
  source: 'int main(){int* p=new int;*p=7;delete p;return 7;}',
};

// A deliberately synthetic heap/alias lifecycle for validating wire invariants.
export function pointerFixture(buildId = 'f'.repeat(64)): MemoryResult {
  const value = fixture(buildId);
  value.language = 'cpp';
  const initial = value.trace!.initialState;
  value.nodeMap = [
    { nodeId: 'n1', kind: 'function', byteRange: { start: 0, end: pointerRequest.source.length } },
    { nodeId: 'n2', kind: 'block', byteRange: { start: 10, end: pointerRequest.source.length } },
    { nodeId: 'n3', kind: 'declaration', byteRange: { start: 11, end: 25 } },
    { nodeId: 'n4', kind: 'return', byteRange: { start: 37, end: 46 } },
    { nodeId: 'n5', kind: 'expression', byteRange: { start: 18, end: 25 } },
    { nodeId: 'n6', kind: 'delete', byteRange: { start: 30, end: 38 } },
  ];
  const frame = {
    id: 'f1',
    functionNodeId: 'n1',
    functionName: 'main',
    parentFrameId: null,
    callNodeId: null,
    scopeIds: ['s1'],
  };
  const scope = { id: 's1', frameId: 'f1', nodeId: 'n2', objectIds: ['o2'], aliases: [] };
  const emptyScope = { ...scope, objectIds: [] };
  const heap: MemoryObject = {
    id: 'o1',
    declarationNodeId: 'n5',
    frameId: null,
    scopeId: null,
    name: 'heap',
    typeName: 'int',
    length: 1,
    byteLength: 4,
    baseAddress: 4096,
    storage: 'heap',
    alive: true,
    zeroInitialized: false,
    cells: [],
  };
  const alias: MemoryObject = {
    id: 'o2',
    declarationNodeId: 'n3',
    frameId: 'f1',
    scopeId: 's1',
    name: 'p',
    typeName: 'int*',
    length: 1,
    byteLength: 8,
    baseAddress: 4100,
    storage: 'automatic',
    alive: true,
    zeroInitialized: false,
    cells: [],
  };
  const pointer = {
    objectId: 'o1',
    byteOffset: 0,
    lowerBound: 0,
    upperBound: 4,
    pointeeType: 'int',
  };
  const control = { ...initial.control, activeFrameId: 'f1', nextNodeId: 'n3' };
  const allocated = {
    ...initial.allocator,
    nextAddress: 4108,
    nextObject: 3,
    nextFrame: 2,
    nextScope: 2,
    liveBytes: 12,
  };
  const entered = { ...initial.allocator, nextFrame: 2, nextScope: 2 };
  value.trace!.steps = [
    {
      seq: 1,
      kind: 'program.enter',
      nodeId: 'n1',
      changes: [
        { op: 'record', table: 'frames', id: 'f1', index: 0, before: null, after: frame },
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: null, after: emptyScope },
        { op: 'control', before: initial.control, after: control },
        { op: 'allocator', before: initial.allocator, after: entered },
      ],
    },
    {
      seq: 2,
      kind: 'memory.allocate',
      nodeId: 'n5',
      changes: [
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: emptyScope, after: scope },
        { op: 'record', table: 'objects', id: 'o1', index: 0, before: null, after: heap },
        { op: 'record', table: 'objects', id: 'o2', index: 1, before: null, after: alias },
        { op: 'allocator', before: entered, after: allocated },
      ],
    },
    {
      seq: 3,
      kind: 'pointer.write',
      nodeId: 'n3',
      changes: [
        { op: 'cell', objectId: 'o1', byteOffset: 0, before: null, after: 7 },
        { op: 'cell', objectId: 'o2', byteOffset: 0, before: null, after: pointer },
      ],
    },
    {
      seq: 4,
      kind: 'memory.release',
      nodeId: 'n6',
      changes: [
        {
          op: 'record',
          table: 'objects',
          id: 'o1',
          index: 0,
          before: { ...heap, cells: [{ byteOffset: 0, value: 7 }] },
          after: { ...heap, alive: false },
        },
        { op: 'allocator', before: allocated, after: { ...allocated, liveBytes: 8 } },
      ],
    },
    {
      seq: 5,
      kind: 'program.return',
      nodeId: 'n4',
      changes: [
        {
          op: 'record',
          table: 'objects',
          id: 'o2',
          index: 1,
          before: { ...alias, cells: [{ byteOffset: 0, value: pointer }] },
          after: { ...alias, alive: false },
        },
        { op: 'record', table: 'scopes', id: 's1', index: 0, before: scope, after: null },
        { op: 'record', table: 'frames', id: 'f1', index: 0, before: frame, after: null },
        {
          op: 'control',
          before: control,
          after: { ...initial.control, nextNodeId: 'n4', returnValue: 7 },
        },
        {
          op: 'allocator',
          before: { ...allocated, liveBytes: 8 },
          after: { ...allocated, liveBytes: 0 },
        },
      ],
    },
  ];
  value.terminal.cursor = 5;
  return value;
}

export const structRequest: MemoryRequest = {
  ...request,
  language: 'cpp',
  source: 'struct Node{int value;Node* next;};int main(){Node n{};n.value=7;n.next=&n;return 7;}',
};
export function zeroStructFixture(): MemoryResult {
  const value = fixture();
  value.language = 'cpp';
  const source = structRequest.source;
  const main = source.indexOf('int main');
  value.nodeMap = [
    { nodeId: 'n1', kind: 'function', byteRange: { start: main, end: source.length } },
    {
      nodeId: 'n2',
      kind: 'block',
      byteRange: { start: source.indexOf('{', main), end: source.length },
    },
    {
      nodeId: 'n3',
      kind: 'declaration',
      byteRange: { start: source.indexOf('Node n'), end: source.indexOf('Node n') + 9 },
    },
    {
      nodeId: 'n4',
      kind: 'return',
      byteRange: { start: source.indexOf('return 7'), end: source.indexOf('return 7') + 9 },
    },
    { nodeId: 'n5', kind: 'struct', byteRange: { start: 0, end: main } },
  ];
  value.types.push(
    {
      name: 'Node',
      kind: 'struct',
      byteSize: 12,
      pointeeType: null,
      fields: [
        { name: 'value', typeName: 'int', byteOffset: 0 },
        { name: 'next', typeName: 'Node*', byteOffset: 4 },
      ],
    },
    { name: 'Node*', kind: 'pointer', byteSize: 8, pointeeType: 'Node', fields: [] },
  );
  const trace = value.trace!;
  const creation = trace.steps[1].changes.find(
    (change) => change.op === 'record' && change.table === 'objects',
  );
  if (!creation || creation.op !== 'record') throw new Error('fixture');
  const object = creation.after as MemoryObject;
  Object.assign(object, { typeName: 'Node', byteLength: 12, zeroInitialized: true });
  const pointer = {
    objectId: 'o1',
    byteOffset: 0,
    lowerBound: 0,
    upperBound: 12,
    pointeeType: 'Node',
  };
  const first = trace.steps[2].changes[0];
  if (first.op !== 'cell') throw new Error('fixture');
  first.before = 0;
  trace.steps[2].changes.push({
    op: 'cell',
    objectId: 'o1',
    byteOffset: 4,
    before: { objectId: null, byteOffset: 0, lowerBound: 0, upperBound: 0, pointeeType: 'Node' },
    after: pointer,
  });
  for (const step of trace.steps)
    for (const change of step.changes) {
      if (change.op === 'allocator')
        for (const record of [change.before, change.after]) {
          if (record.nextObject === 2) {
            record.nextAddress = 4108;
            if (record.liveBytes) record.liveBytes = 12;
          }
        }
    }
  const release = trace.steps[3].changes[0];
  if (release.op !== 'record') throw new Error('fixture');
  release.before = {
    ...object,
    cells: [
      { byteOffset: 0, value: 7 },
      { byteOffset: 4, value: pointer },
    ],
  };
  release.after = { ...object, alive: false };
  return value;
}
