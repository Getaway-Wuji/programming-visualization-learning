/** Replays only committed Rust facts. No Python expressions are evaluated here. */
import { c6Assert as assert, c6Equal as equal } from './c6-player';
import type {
  PythonChange,
  PythonNode,
  PythonState,
  PythonStep,
  PythonTrace,
  PythonValue,
} from './python3-types';

const utf8 = new TextEncoder();
const size = (text: string) => utf8.encode(text).byteLength;
const listKey = (id: number) => 'o' + id;
const empty: PythonState = {
  globals: {},
  frames: [],
  objects: {},
  control: { nodeId: null, pending: [], inputCursor: 0, iterations: [] },
  allocator: { nextObject: 0, nextFrame: 0, liveBytes: 0 },
  counters: { assignments: 0, listWrites: 0, comparisons: 0, calls: 0 },
  output: '',
};
function replace<T>(table: Record<string, T>, key: string, before: T | null, after: T | null) {
  assert(equal(Object.hasOwn(table, key) ? table[key] : null, before));
  if (after === null) delete table[key];
  else
    Object.defineProperty(table, key, {
      value: after,
      writable: true,
      enumerable: true,
      configurable: true,
    });
}

function applyChange(state: PythonState, change: PythonChange, forward: boolean) {
  if (change.op === 'output') {
    const bytes = size(change.append);
    assert(change.afterBytes === change.beforeBytes + bytes);
    if (forward) {
      assert(size(state.output) === change.beforeBytes);
      state.output += change.append;
    } else {
      assert(size(state.output) === change.afterBytes && state.output.endsWith(change.append));
      state.output = state.output.slice(0, state.output.length - change.append.length);
    }
    return;
  }
  const pair = <T>(value: { before: T; after: T }) =>
    forward ? ([value.before, value.after] as const) : ([value.after, value.before] as const);
  switch (change.op) {
    case 'binding': {
      const frame = state.frames.find(({ id }) => id === change.frameId);
      const table = change.frameId === 0 ? state.globals : frame?.bindings;
      assert(table);
      replace(table, change.name, ...pair(change));
      break;
    }
    case 'object': {
      const [from, to] = pair(change);
      replace(state.objects, listKey(change.objectId), from, to?.slice() ?? null);
      break;
    }
    case 'slot': {
      const values = state.objects[listKey(change.objectId)];
      const [from, to] = pair(change);
      const length = forward ? change.beforeLen : change.afterLen;
      const next = forward ? change.afterLen : change.beforeLen;
      assert(values?.length === length && change.index <= length && (from !== null || to !== null));
      if (from === null) values.splice(change.index, 0, to!);
      else {
        assert(equal(values[change.index], from));
        values.splice(change.index, 1, ...(to === null ? [] : [to]));
      }
      assert(values.length === next);
      break;
    }
    case 'frame': {
      const [from, to] = pair(change);
      if (from) assert(equal(state.frames.pop(), from));
      if (to) {
        assert(state.frames.length < 32 && state.frames.every(({ id }) => id !== to.id));
        state.frames.push({ ...to, bindings: { ...to.bindings } });
      }
      break;
    }
    case 'control': {
      const [from, to] = pair(change);
      assert(equal(state.control, from));
      state.control = to;
      break;
    }
    case 'allocator': {
      const [from, to] = pair(change);
      assert(equal(state.allocator, from));
      state.allocator = to;
      break;
    }
    case 'counters': {
      const [from, to] = pair(change);
      assert(equal(state.counters, from));
      state.counters = to;
      break;
    }
  }
}

function apply(state: PythonState, step: PythonStep, forward: boolean) {
  if (forward) {
    for (const change of step.changes) applyChange(state, change, true);
  } else {
    for (let i = step.changes.length - 1; i >= 0; i--) applyChange(state, step.changes[i], false);
  }
}

function checkValue(value: PythonValue | null, state: PythonState, nodes: Map<number, PythonNode>) {
  if (value?.kind === 'str') assert(size(value.value) <= 4096);
  if (value?.kind === 'f64') assert((parseInt(value.bits.slice(0, 3), 16) & 0x7ff) !== 0x7ff);
  if (value?.kind === 'list-ref') assert(Object.hasOwn(state.objects, listKey(value.objectId)));
  if (value?.kind === 'function-ref') assert(nodes.get(value.nodeId)?.kind === 'def');
}

function checkState(state: PythonState, nodes: Map<number, PythonNode>) {
  for (const value of Object.values(state.globals)) checkValue(value, state, nodes);
  for (const frame of state.frames) {
    assert(
      nodes.get(frame.functionNodeId)?.kind === 'def' &&
        nodes.get(frame.callNodeId)?.kind === 'call',
    );
    for (const value of Object.values(frame.bindings)) checkValue(value, state, nodes);
  }
  for (const [id, items] of Object.entries(state.objects)) {
    assert(Number(id.slice(1)) <= state.allocator.nextObject);
    for (const value of items) checkValue(value, state, nodes);
  }
}

export function* verifyPythonTrace(
  trace: PythonTrace,
  nodes: Map<number, PythonNode>,
  inputBytes: number,
): Generator<void, { steps: number; objects: number; outputBytes: number; output: string }> {
  assert(equal(trace.initialState, empty));
  assert(trace.checkpoints.length === Math.floor(trace.steps.length / 128));
  const state = structuredClone(trace.initialState);
  for (const [index, step] of trace.steps.entries()) {
    assert(step.seq === index + 1 && nodes.has(step.nodeId));
    // The projector copies mutable list slots and frame bindings as they enter state.
    apply(state, step, true);
    checkValue(step.value, state, nodes);
    assert(state.control.nodeId === step.nodeId && state.control.inputCursor <= inputBytes);
    assert(state.control.pending.every((id) => nodes.has(id)));
    for (const loop of state.control.iterations) {
      assert(
        nodes.has(loop.nodeId) &&
          (loop.frameId === 0 || state.frames.some((frame) => frame.id === loop.frameId)),
      );
    }
    let validateRelations = false;
    for (const change of step.changes) {
      if (change.op === 'binding' || change.op === 'slot') checkValue(change.after, state, nodes);
      else if (change.op === 'object' && change.after) {
        assert(change.objectId <= state.allocator.nextObject);
        for (const item of change.after) checkValue(item, state, nodes);
      } else if (change.op === 'object' || change.op === 'frame') validateRelations = true;
    }
    if (validateRelations) checkState(state, nodes);
    if (step.seq % 128 === 0) {
      const checkpoint = trace.checkpoints[step.seq / 128 - 1];
      assert(checkpoint.cursor === step.seq && equal(checkpoint.state, state));
    }
    if (index % 64 === 0) yield;
  }
  checkState(state, nodes);
  const result = {
    steps: trace.steps.length,
    objects: state.allocator.nextObject,
    outputBytes: size(state.output),
    output: state.output,
  };
  for (let index = trace.steps.length - 1; index >= 0; index--) {
    apply(state, trace.steps[index], false);
    if (index % 64 === 0) yield;
  }
  assert(equal(state, trace.initialState));
  return result;
}

export class PythonPlayer {
  private cursor = 0;
  private state: PythonState;
  constructor(private readonly trace: PythonTrace) {
    this.state = structuredClone(trace.initialState);
  }
  seek(cursor: number) {
    assert(Number.isInteger(cursor) && cursor >= 0 && cursor <= this.trace.steps.length);
    if (Math.abs(cursor - this.cursor) >= 128) {
      const checkpoint = this.trace.checkpoints[Math.floor(cursor / 128) - 1];
      this.state = structuredClone(checkpoint?.state ?? this.trace.initialState);
      this.cursor = checkpoint?.cursor ?? 0;
    }
    while (this.cursor < cursor) apply(this.state, this.trace.steps[this.cursor++], true);
    while (this.cursor > cursor) apply(this.state, this.trace.steps[--this.cursor], false);
    return this.current();
  }
  current() {
    return { cursor: this.cursor, state: structuredClone(this.state) };
  }
}
