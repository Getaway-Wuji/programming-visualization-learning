import { expect, test } from 'vitest';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import {
  canonicalMemoryJson,
  decodeMemoryResult,
  encodeMemoryRequest,
  type MemoryResult,
  type MemoryPointer,
  projectMemoryStep,
} from '../../web/src/engine/memory-protocol';
import {
  fixture,
  request,
  pointerFixture,
  pointerRequest,
  zeroStructFixture,
  structRequest,
} from './memory-fixture';

const bytes = (value: unknown) => new TextEncoder().encode(canonicalMemoryJson(value)).buffer;
const decode = (value: unknown) => decodeMemoryResult(bytes(value), request, 'f'.repeat(64));

test('private full validation preserves every supplied pointer record and checkpoint', async () => {
  const original = pointerFixture();
  const result = await decodeMemoryResult(bytes(original), pointerRequest, 'f'.repeat(64));
  expect(result).toEqual(original);
});

test.each(['nextAddress', 'nextObject', 'liveBytes'] as const)(
  'an unchanged object table still checks a changed allocator %s',
  async (key) => {
    const value = pointerFixture();
    const trace = value.trace!;
    const state = trace.steps
      .slice(0, 3)
      .reduce((state, step) => projectMemoryStep(state, step, value.types), trace.initialState);
    trace.steps.splice(3, 0, {
      seq: 4,
      kind: 'nop',
      nodeId: 'n3',
      changes: [
        {
          op: 'allocator',
          before: state.allocator,
          after: { ...state.allocator, [key]: key === 'nextAddress' ? 4096 : 1 },
        },
      ],
    });
    trace.steps.forEach((step, index) => {
      step.seq = index + 1;
    });
    value.terminal.cursor++;
    await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
      'E_PROTOCOL_INVALID',
    );
  },
);

test('an unchanged object table still rejects an orphaned control pointer', async () => {
  const value = pointerFixture();
  const trace = value.trace!;
  const state = trace.steps
    .slice(0, 3)
    .reduce((state, step) => projectMemoryStep(state, step, value.types), trace.initialState);
  trace.steps.splice(3, 0, {
    seq: 4,
    kind: 'nop',
    nodeId: 'n3',
    changes: [
      {
        op: 'control',
        before: state.control,
        after: {
          ...state.control,
          returnValue: {
            objectId: 'o99',
            byteOffset: 0,
            lowerBound: 0,
            upperBound: 4,
            pointeeType: 'int',
          },
        },
      },
    ],
  });
  trace.steps.forEach((step, index) => {
    step.seq = index + 1;
  });
  value.terminal.cursor++;
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('public inverse record projection keeps nested pointers isolated from the trace and earlier state', () => {
  const value = pointerFixture();
  const trace = value.trace!;
  const state = trace.steps
    .slice(0, 4)
    .reduce((state, step) => projectMemoryStep(state, step, value.types), trace.initialState);
  const released = projectMemoryStep(state, trace.steps[4], value.types);
  const previous = structuredClone(released);
  const source = structuredClone(value);
  const next = projectMemoryStep(released, trace.steps[4], value.types, true);
  next.objects[1].name = 'consumer edit';
  (next.objects[1].cells[0].value as MemoryPointer).byteOffset = 1;
  expect(released).toEqual(previous);
  expect(value).toEqual(source);
});

test('public cell projection keeps a consumer pointer edit out of the recorded delta', () => {
  const value = pointerFixture();
  const trace = value.trace!;
  const state = trace.steps
    .slice(0, 2)
    .reduce((state, step) => projectMemoryStep(state, step, value.types), trace.initialState);
  const previous = structuredClone(state);
  const source = structuredClone(value);
  const next = projectMemoryStep(state, trace.steps[2], value.types);
  (next.objects[1].cells[0].value as MemoryPointer).upperBound = 0;
  expect(state).toEqual(previous);
  expect(value).toEqual(source);
});
test('closed branch accepts canonical synthetic deltas and restores returned objects', async () => {
  const value = await decode(fixture());
  const player = new MemoryPlayer();
  player.accept(value);
  const initial = player.snapshot();
  expect(player.seek(4)).toBe(true);
  expect(player.snapshot().state?.frames).toEqual([]);
  expect(player.seek(3)).toBe(true);
  expect(player.snapshot().state?.objects[0].cells).toEqual([{ byteOffset: 0, value: 7 }]);
  for (let cursor = 2; cursor >= 0; cursor--) expect(player.seek(cursor)).toBe(true);
  expect(player.snapshot().state).toEqual(initial.state);
  player.play();
  player.tick();
  player.pause();
  const paused = player.snapshot();
  expect(player.tick()).toBe(false);
  expect(player.snapshot()).toEqual(paused);
  expect(player.seek(0)).toBe(true);
  player.invalidate();
  expect(player.seek(1)).toBe(false);
});
test.each([
  [
    'unknown version',
    (v: MemoryResult) => {
      v.execVersion = '2.0.0' as '1.3.0';
    },
  ],
  [
    'language mismatch',
    (v: MemoryResult) => {
      v.language = 'cpp';
    },
  ],
  [
    'build mismatch',
    (v: MemoryResult) => {
      v.engine.buildId = 'a'.repeat(64);
    },
  ],
  [
    'identity mismatch',
    (v: MemoryResult) => {
      v.identity.sourceRevision = 'stale';
    },
  ],
  [
    'unknown node kind',
    (v: MemoryResult) => {
      v.nodeMap[0].kind = 'future';
    },
  ],
  [
    'unknown event',
    (v: MemoryResult) => {
      v.trace!.steps[0].kind = 'future';
    },
  ],
  [
    'wrong before',
    (v: MemoryResult) => {
      const c = v.trace!.steps[2].changes[0];
      if (c.op === 'cell') c.before = 6;
    },
  ],
  [
    'wrong checkpoint',
    (v: MemoryResult) => {
      v.trace!.checkpoints[0].state.allocator.nextFrame = 2;
    },
  ],
  [
    'dangling frame',
    (v: MemoryResult) => {
      const c = v.trace!.steps[0].changes[0];
      if (c.op === 'record' && c.after && 'parentFrameId' in c.after) c.after.parentFrameId = 'f5';
    },
  ],
  [
    'unknown field',
    (v: MemoryResult) => {
      Object.assign(v.trace!.initialState, { future: true });
    },
  ],
  [
    'false terminal',
    (v: MemoryResult) => {
      v.terminal.returnValue = 6;
    },
  ],
  [
    'partial success',
    (v: MemoryResult) => {
      v.trace!.completeness = 'prefix';
    },
  ],
  [
    'invalid source boundary',
    (v: MemoryResult) => {
      v.nodeMap[0].byteRange.end = 100;
    },
  ],
  [
    'extra checkpoint',
    (v: MemoryResult) => {
      v.trace!.checkpoints.push(structuredClone(v.trace!.checkpoints[0]));
    },
  ],
] as const)('rejects %s', async (_name, mutate) => {
  const value = fixture();
  mutate(value);
  await expect(decode(value)).rejects.toThrow('E_PROTOCOL_INVALID');
});
test('duplicate keys, trailing input and noncanonical integers are rejected before native parsing', async () => {
  const text = canonicalMemoryJson(fixture());
  for (const invalid of [
    text.replace('"execVersion":', '"execVersion":"1.3.0","execVersion":'),
    `${text} `,
    text.replace('"fuelUsed":100', '"fuelUsed":1e2'),
  ]) {
    await expect(
      decodeMemoryResult(new TextEncoder().encode(invalid).buffer, request, 'f'.repeat(64)),
    ).rejects.toThrow('E_PROTOCOL_INVALID');
  }
});

test('the raw result must place trace before types in canonical key order', async () => {
  const ordered = Object.entries(JSON.parse(canonicalMemoryJson(fixture())));
  const trace = ordered.findIndex(([key]) => key === 'trace');
  const types = ordered.findIndex(([key]) => key === 'types');
  [ordered[trace], ordered[types]] = [ordered[types], ordered[trace]];
  const wire = new TextEncoder().encode(JSON.stringify(Object.fromEntries(ordered))).buffer;
  await expect(decodeMemoryResult(wire, request, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});
test.each([
  ['cancelled', 'E_CANCELLED'],
  ['limited', 'E_DEADLINE'],
] as const)('rejects a result claiming %s even without a trace', async (status, code) => {
  const value = fixture();
  value.trace = null;
  value.terminal = { status, code, byteRange: null, cursor: 0, returnValue: null };
  await expect(decode(value)).rejects.toThrow('E_PROTOCOL_INVALID');
});
test('source Unicode scalar and CRLF boundaries are checked without normalization', async () => {
  const req = { ...request, source: '//😀\r\nint main(){return 0;}' };
  const value = fixture();
  value.trace = null;
  value.terminal = {
    status: 'error',
    code: 'E_PARSE_INVALID',
    byteRange: { start: 3, end: 3 },
    cursor: 0,
    returnValue: null,
  };
  value.nodeMap = [];
  await expect(decodeMemoryResult(bytes(value), req, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  value.terminal.byteRange = { start: 7, end: 7 };
  await expect(decodeMemoryResult(bytes(value), req, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  value.terminal.byteRange = { start: 8, end: 8 };
  await expect(decodeMemoryResult(bytes(value), req, 'f'.repeat(64))).resolves.toMatchObject({
    terminal: { status: 'error' },
  });
});
test('request snapshots have exact versions, no extensions and bounded integers', () => {
  expect(new TextDecoder().decode(encodeMemoryRequest(request))).toBe(canonicalMemoryJson(request));
  expect(() => encodeMemoryRequest({ ...request, input: [2147483648] })).toThrow();
  expect(() => encodeMemoryRequest({ ...request, source: 'x'.repeat(32769) })).toThrow();
  expect(() => encodeMemoryRequest({ ...request, source: '\ud800' })).toThrow();
  expect(() => encodeMemoryRequest({ ...request, input: [1000] })).toThrow();
  expect(() => encodeMemoryRequest(Object.assign({ ...request }, { unknown: true }))).toThrow();
});

test('typed pointers keep a dead object identity and reverse a heap release from its recorded value', async () => {
  const value = await decodeMemoryResult(bytes(pointerFixture()), pointerRequest, 'f'.repeat(64));
  const player = new MemoryPlayer();
  player.accept(value);
  player.seek(4);
  expect(player.snapshot().state?.objects[0]).toMatchObject({ alive: false, cells: [] });
  expect(player.snapshot().state?.objects[1].cells[0].value).toMatchObject({ objectId: 'o1' });
  player.seek(3);
  expect(player.snapshot().state?.objects[0]).toMatchObject({
    alive: true,
    cells: [{ byteOffset: 0, value: 7 }],
  });
  player.seek(5);
  expect(player.snapshot().state?.objects.every((object) => !object.alive)).toBe(true);
  player.seek(0);
  expect(player.snapshot().state).toEqual(value.trace!.initialState);
});

test('an invalid pointer cannot be hidden by overwriting the same cell within a step', async () => {
  const value = pointerFixture();
  const step = value.trace!.steps[2];
  const change = step.changes[1];
  if (change.op !== 'cell') throw new Error('fixture');
  const valid = structuredClone(change.after);
  change.after = { ...(valid as MemoryPointer), objectId: 'o999' };
  step.changes.push({ ...structuredClone(change), before: change.after, after: valid });
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('record replacement and cell writes cannot overlap on one object in a step', async () => {
  const value = pointerFixture();
  value.trace!.steps[1].changes.push({
    op: 'cell',
    objectId: 'o2',
    byteOffset: 0,
    before: null,
    after: null,
  });
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('a step cannot hide an intermediate control value behind a second control write', async () => {
  const value = pointerFixture();
  const step = value.trace!.steps[0];
  const change = step.changes.find((item) => item.op === 'control');
  if (change?.op !== 'control') throw new Error('fixture');
  const valid = structuredClone(change.after);
  change.after = {
    ...valid,
    returnValue: {
      objectId: 'o999',
      byteOffset: 0,
      lowerBound: 0,
      upperBound: 4,
      pointeeType: 'int',
    },
  };
  step.changes.push({ ...structuredClone(change), before: change.after, after: valid });
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('projection preserves its source state and deltas while copying only changed tables', () => {
  const value = pointerFixture();
  const trace = value.trace!;
  let state = trace.initialState;
  for (const step of trace.steps.slice(0, 2)) state = projectMemoryStep(state, step, value.types);
  const before = canonicalMemoryJson(state);
  const recorded = canonicalMemoryJson(trace.steps[2]);
  const next = projectMemoryStep(state, trace.steps[2], value.types);
  expect(next.frames).toBe(state.frames);
  expect(next.scopes).toBe(state.scopes);
  expect(next.objects).not.toBe(state.objects);
  expect(canonicalMemoryJson(state)).toBe(before);
  expect(canonicalMemoryJson(trace.steps[2])).toBe(recorded);
  expect(projectMemoryStep(next, trace.steps[2], value.types, true)).toEqual(state);
});

test.each([
  [
    'unknown target',
    (pointer: MemoryPointer) => {
      pointer.objectId = 'o3';
    },
  ],
  [
    'forged numeric address',
    (pointer: MemoryPointer) => {
      Object.assign(pointer, { address: 4096 });
    },
  ],
  [
    'forged provenance bounds',
    (pointer: MemoryPointer) => {
      pointer.upperBound = 8;
    },
  ],
  [
    'interior byte misalignment',
    (pointer: MemoryPointer) => {
      pointer.byteOffset = 1;
    },
  ],
  [
    'pointer type mismatch',
    (pointer: MemoryPointer) => {
      pointer.pointeeType = 'int*';
    },
  ],
] as const)('rejects %s in pointer cells', async (_label, mutate) => {
  const value = pointerFixture();
  const change = value.trace!.steps[2].changes[1];
  if (change.op !== 'cell') throw new Error('fixture');
  mutate(change.after as MemoryPointer);
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('one-past pointer can be represented, but a dead object cannot be silently resurrected', async () => {
  const value = pointerFixture();
  for (const step of value.trace!.steps)
    for (const change of step.changes) {
      if (change.op === 'cell' && change.objectId === 'o2')
        (change.after as MemoryPointer).byteOffset = 4;
      if (change.op === 'record' && change.before && 'cells' in change.before)
        for (const cell of change.before.cells)
          if (typeof cell.value === 'object' && cell.value !== null) cell.value.byteOffset = 4;
    }
  await expect(
    decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64)),
  ).resolves.toBeDefined();
  const release = value.trace!.steps[3];
  const state = value
    .trace!.steps.slice(0, 3)
    .reduce(
      (state, step) => projectMemoryStep(state, step, value.types),
      value.trace!.initialState,
    );
  const released = projectMemoryStep(state, release, value.types);
  expect(projectMemoryStep(released, release, value.types, true)).toEqual(state);
  const copied = structuredClone(release);
  copied.seq = 5;
  const record = copied.changes[0];
  if (record.op !== 'record') throw new Error('fixture');
  [record.before, record.after] = [record.after, record.before];
  value.trace!.steps.splice(4, 0, copied);
  await expect(decodeMemoryResult(bytes(value), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('a malformed type layout and an object-byte accounting mismatch reject the entire result', async () => {
  const layout = pointerFixture();
  layout.types[1].byteSize = 4;
  await expect(decodeMemoryResult(bytes(layout), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  const length = pointerFixture();
  const create = length.trace!.steps[1].changes[2];
  if (create.op !== 'record' || !create.after || !('byteLength' in create.after))
    throw new Error('fixture');
  create.after.byteLength = 4;
  await expect(decodeMemoryResult(bytes(length), pointerRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('syntax errors may have an empty type table, while executable traces require a complete type table', async () => {
  const value = fixture();
  value.types = [];
  await expect(decode(value)).rejects.toThrow('E_PROTOCOL_INVALID');
  value.trace = null;
  value.terminal = {
    status: 'error',
    code: 'E_PARSE_INVALID',
    byteRange: { start: 0, end: 0 },
    cursor: 0,
    returnValue: null,
  };
  await expect(decode(value)).resolves.toBeDefined();
});

test('sparse zero-initialized structures recover typed null fields without materializing every slot', async () => {
  const value = await decodeMemoryResult(bytes(zeroStructFixture()), structRequest, 'f'.repeat(64));
  const player = new MemoryPlayer();
  player.accept(value);
  player.seek(3);
  expect(player.snapshot().state?.objects[0].cells).toEqual([
    { byteOffset: 0, value: 7 },
    {
      byteOffset: 4,
      value: { objectId: 'o1', byteOffset: 0, lowerBound: 0, upperBound: 12, pointeeType: 'Node' },
    },
  ]);
  player.seek(2);
  expect(player.snapshot().state?.objects[0]).toMatchObject({ zeroInitialized: true, cells: [] });
  const malformed = zeroStructFixture();
  const pointer = malformed.trace!.steps[2].changes.at(-1)!;
  if (pointer.op !== 'cell') throw new Error('fixture');
  pointer.before = null;
  await expect(decodeMemoryResult(bytes(malformed), structRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
});

test('field pointers stay within their originating subobject rather than a forged enclosing structure', async () => {
  const value = zeroStructFixture();
  const selfWrite = value.trace!.steps[2].changes.at(-1)!;
  if (selfWrite.op !== 'cell') throw new Error('fixture');
  (selfWrite.after as MemoryPointer).pointeeType = 'int';
  (selfWrite.after as MemoryPointer).upperBound = 4;
  await expect(decodeMemoryResult(bytes(value), structRequest, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  const wrongLayout = zeroStructFixture();
  wrongLayout.types[2].fields[1].byteOffset = 0;
  await expect(
    decodeMemoryResult(bytes(wrongLayout), structRequest, 'f'.repeat(64)),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
});

for (const target of ['o999', 'o1'])
  test(`cell-only writes cannot reuse layout validation for forged target ${target}`, async () => {
    const value = zeroStructFixture();
    const change = value.trace!.steps[2].changes.at(-1)!;
    if (change.op !== 'cell') throw new Error('fixture');
    const pointer = change.after as MemoryPointer;
    pointer.objectId = target;
    if (target === 'o1') pointer.upperBound += 12;
    await expect(decodeMemoryResult(bytes(value), structRequest, 'f'.repeat(64))).rejects.toThrow(
      'E_PROTOCOL_INVALID',
    );
  });
