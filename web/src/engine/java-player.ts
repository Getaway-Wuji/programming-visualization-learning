import { c6Assert as assert, c6Equal as equal } from './c6-player';
import type {
  JavaChange,
  JavaNode,
  JavaFrame,
  JavaObject,
  JavaState,
  JavaStep,
  JavaTrace,
  JavaValue,
} from './java-types';

const utf8 = new TextEncoder();
const size = (text: string) => utf8.encode(text).byteLength;
const objectKey = (id: number) => 'o' + String(id).padStart(4, '0');
const initialState: JavaState = {
  frames: [],
  objects: {},
  control: { nodeId: null, path: [], inputCursor: 0 },
  allocator: { objects: 0, frames: 0, liveBytes: 0 },
  counters: { writes: 0, calls: 0, comparisons: 0 },
  output: '',
};

function get<T>(table: Record<string, T>, key: string): T | null {
  return Object.hasOwn(table, key) ? table[key] : null;
}

function set<T>(table: Record<string, T>, key: string, value: T | null) {
  if (value === null) {
    delete table[key];
  } else {
    Object.defineProperty(table, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

function valueBytes(value: JavaValue | null): number {
  return value === null ? 0 : 48 + (value.kind === 'string' ? size(value.value) : 0);
}

function bindingBytes(name: string, value: JavaValue | null): number {
  return value === null ? 0 : name.length + valueBytes(value);
}

function frameBytes(frame: JavaFrame | null): number {
  return frame === null
    ? 0
    : 64 +
        Object.entries(frame.bindings).reduce(
          (bytes, [name, value]) => bytes + bindingBytes(name, value),
          0,
        );
}

function objectBytes(object: JavaObject): number {
  if (object.kind === 'instance') {
    return (
      80 +
      object.className.length +
      Object.entries(object.fields).reduce(
        (bytes, [name, value]) => bytes + bindingBytes(name, value),
        0,
      )
    );
  }
  if (object.kind === 'int-array' || object.kind === 'string-array') {
    return 80 + object.slots.reduce((bytes, value) => bytes + valueBytes(value), 0);
  }
  return 80;
}

function checkValue(value: JavaValue | null, state: JavaState) {
  if (value?.kind === 'ref') assert(get(state.objects, objectKey(value.objectId)));
  if (value?.kind === 'long') {
    const integer = BigInt(value.value);
    assert(integer >= -(1n << 63n) && integer < 1n << 63n);
  }
  if (value?.kind === 'string') assert(size(value.value) <= 4096);
}

function checkSlot(object: JavaObject, value: JavaValue) {
  assert(
    (object.kind === 'int-array' && value.kind === 'int') ||
      (object.kind === 'string-array' && (value.kind === 'null' || value.kind === 'string')),
  );
}

function apply(state: JavaState, change: JavaChange, forward: boolean) {
  const prior = forward ? 'before' : 'after';
  const next = forward ? 'after' : 'before';
  switch (change.op) {
    case 'binding': {
      const frame = state.frames.find((item) => item.id === change.frameId);
      assert(frame && equal(get(frame.bindings, change.name), change[prior]));
      set(frame.bindings, change.name, change[next]);
      checkValue(change[next], state);
      break;
    }
    case 'frame': {
      const previous = change[prior];
      const frame = change[next];
      assert((previous === null) !== (frame === null));
      if (frame) {
        assert(state.frames.length < 32 && !state.frames.some((item) => item.id === frame.id));
        for (const value of Object.values(frame.bindings)) checkValue(value, state);
        state.frames.push({ ...frame, bindings: { ...frame.bindings } });
      } else {
        assert(equal(state.frames.at(-1), previous));
        state.frames.pop();
      }
      break;
    }
    case 'object': {
      const id = objectKey(change.objectId);
      assert(equal(get(state.objects, id), change[prior]));
      const object = change[next];
      if (object?.kind === 'int-array' || object?.kind === 'string-array') {
        for (const item of object.slots) {
          checkSlot(object, item);
          checkValue(item, state);
        }
      } else if (object?.kind === 'instance') {
        for (const item of Object.values(object.fields)) checkValue(item, state);
      }
      set(state.objects, id, object ? structuredClone(object) : null);
      break;
    }
    case 'slot': {
      const object = get(state.objects, objectKey(change.objectId));
      assert(object?.kind === 'int-array' || object?.kind === 'string-array');
      assert(
        change.index < object.slots.length && equal(object.slots[change.index], change[prior]),
      );
      const value = change[next];
      checkSlot(object, value);
      checkValue(value, state);
      object.slots[change.index] = value;
      break;
    }
    case 'field': {
      const object = get(state.objects, objectKey(change.objectId));
      assert(object?.kind === 'instance' && equal(get(object.fields, change.name), change[prior]));
      checkValue(change[next], state);
      set(object.fields, change.name, change[next]);
      break;
    }
    case 'control':
      assert(equal(state.control, change[prior]));
      state.control = change[next];
      break;
    case 'allocator':
      assert(equal(state.allocator, change[prior]));
      state.allocator = change[next];
      break;
    case 'counters':
      assert(equal(state.counters, change[prior]));
      state.counters = change[next];
      break;
    case 'output':
      if (forward) state.output += change.append;
      else {
        assert(state.output.endsWith(change.append));
        state.output = state.output.slice(0, state.output.length - change.append.length);
      }
      break;
  }
}

function applyStep(state: JavaState, step: JavaStep, forward: boolean) {
  const changes = step.changes;
  for (let i = 0; i < changes.length; i++) {
    apply(state, changes[forward ? i : changes.length - i - 1], forward);
  }
}

export function* verifyJavaTrace(
  trace: JavaTrace,
  nodes: ReadonlyMap<number, JavaNode>,
  inputBytes: number,
) {
  assert(equal(initialState, trace.initialState));
  const state = structuredClone(initialState);
  let outputBytes = 0;
  let objects = 0;
  let frames = 0;
  let liveBytes = 0;
  let checkpoints = 0;
  for (const [index, step] of trace.steps.entries()) {
    assert(step.seq === index + 1 && nodes.has(step.nodeId));
    const before = state.counters;
    const beforeInput = state.control.inputCursor;
    let expectedWrites = 0;
    let expectedCalls = 0;
    let expectedComparisons = 0;
    let prints = 0;
    for (const change of step.changes) {
      switch (change.op) {
        case 'object':
          assert(step.kind === 'allocate' && change.before === null && change.after);
          assert(change.objectId === ++objects);
          liveBytes += objectBytes(change.after);
          break;
        case 'frame':
          if (step.kind === 'frame-enter') {
            assert(change.before === null && change.after?.id === ++frames);
            assert(
              nodes.get(change.after.methodNodeId)?.kind === 'method' &&
                nodes.has(change.after.callNodeId),
            );
            expectedCalls++;
          } else assert(step.kind === 'frame-exit' && change.before && change.after === null);
          liveBytes += frameBytes(change.after) - frameBytes(change.before);
          break;
        case 'binding':
          liveBytes +=
            bindingBytes(change.name, change.after) - bindingBytes(change.name, change.before);
          if (step.kind === 'scope-exit') assert(change.before && change.after === null);
          else {
            assert(
              (step.kind === 'declare' && change.before === null && change.after) ||
                (step.kind === 'assign' && change.before && change.after),
            );
            expectedWrites++;
          }
          break;
        case 'slot':
        case 'field':
          assert(step.kind === 'object-write');
          liveBytes += valueBytes(change.after) - valueBytes(change.before);
          expectedWrites++;
          break;
        case 'control':
          liveBytes += (change.after.path.length - change.before.path.length) * 4;
          assert(
            change.after.nodeId === step.nodeId && change.after.path.every((id) => nodes.has(id)),
          );
          break;
        case 'output':
          assert(step.kind === 'print' && change.beforeBytes === outputBytes);
          outputBytes += size(change.append);
          assert(change.afterBytes === outputBytes);
          liveBytes += change.afterBytes - change.beforeBytes;
          prints++;
          break;
      }
    }
    if (step.kind === 'compare') expectedComparisons++;
    applyStep(state, step, true);
    assert(state.control.nodeId === step.nodeId);
    assert(
      step.kind === 'input-read'
        ? state.control.inputCursor > beforeInput && state.control.inputCursor <= inputBytes
        : state.control.inputCursor === beforeInput,
    );
    assert(
      state.allocator.objects === objects &&
        state.allocator.frames === frames &&
        state.allocator.liveBytes === liveBytes,
    );
    assert(
      state.counters.writes === before.writes + expectedWrites &&
        state.counters.calls === before.calls + expectedCalls &&
        state.counters.comparisons === before.comparisons + expectedComparisons &&
        prints === (step.kind === 'print' ? 1 : 0),
    );
    checkValue(step.value, state);
    if (step.seq % 128 === 0) {
      const point = trace.checkpoints[checkpoints++];
      assert(point?.cursor === step.seq && equal(point.state, state));
    }
    if (step.seq % 128 === 0) yield;
  }
  assert(checkpoints === trace.checkpoints.length && size(state.output) === outputBytes);
  if (trace.completeness === 'complete') assert(state.frames.length === 0);
  const output = state.output;
  for (let index = trace.steps.length - 1; index >= 0; index--) {
    applyStep(state, trace.steps[index], false);
    if (index % 128 === 0) yield;
  }
  assert(equal(state, initialState));
  return { steps: trace.steps.length, objects, outputBytes, output };
}

export class JavaPlayer {
  private cursor = 0;
  private state: JavaState;

  constructor(private readonly trace: JavaTrace) {
    this.state = structuredClone(trace.initialState);
  }

  seek(cursor: number) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.trace.steps.length) {
      throw new RangeError('E_JAVA_CURSOR');
    }
    const checkpoint = this.trace.checkpoints[Math.floor(cursor / 128) - 1];
    if (checkpoint && Math.abs(this.cursor - cursor) > cursor - checkpoint.cursor) {
      this.cursor = checkpoint.cursor;
      this.state = structuredClone(checkpoint.state);
    }
    while (this.cursor < cursor) applyStep(this.state, this.trace.steps[this.cursor++], true);
    while (this.cursor > cursor) applyStep(this.state, this.trace.steps[--this.cursor], false);
    return {
      cursor,
      state: structuredClone(this.state),
      step: cursor ? this.trace.steps[cursor - 1] : null,
    };
  }
}
