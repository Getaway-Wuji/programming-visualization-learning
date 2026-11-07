import type {
  RustBinding,
  RustNode,
  RustReplay,
  RustState,
  RustStep,
  RustTable,
  RustTrace,
  RustType,
  RustValue,
} from './rust2018-protocol';

export function rustAssert(value: unknown): asserts value {
  if (!value) throw new Error('E_PROTOCOL_INVALID');
}
export function rustEqual(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const first = Object.keys(a),
      second = Object.keys(b);
    if (first.length !== second.length) return false;
    for (const key of first) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
    }
  }
  return true;
}
const encoder = new TextEncoder();
const size = (text: string) => encoder.encode(text).byteLength;
const initial: RustState = {
  frames: [],
  bindings: [],
  objects: [],
  loans: [],
  temporaries: [],
  control: { nodeId: null, inputCursor: 0, returnValue: null },
  allocator: {
    nextFrame: 1,
    nextScope: 1,
    nextBinding: 1,
    nextObject: 1,
    nextLoan: 1,
    nextTemporary: 1,
    liveBytes: 0,
  },
  output: '',
};
const tableCounter = {
  bindings: 'nextBinding',
  objects: 'nextObject',
  loans: 'nextLoan',
  temporaries: 'nextTemporary',
} as const;
function indexed<T extends { id: number }>(rows: T[], next: number) {
  const map = new Map<number, T>();
  let last = 0;
  for (const row of rows) {
    rustAssert(row.id > last && row.id < next);
    map.set(row.id, row);
    last = row.id;
  }
  return map;
}
function objectValue(value: RustValue) {
  return value.kind === 'string-object' || value.kind === 'array-object' ? value.objectId : null;
}
function validateState(state: RustState, nodes: ReadonlyMap<number, RustNode>, input: string) {
  const allocator = state.allocator;
  const frames = indexed(state.frames, allocator.nextFrame);
  const bindings = indexed(state.bindings, allocator.nextBinding);
  const objects = indexed(state.objects, allocator.nextObject);
  const loans = indexed(state.loans, allocator.nextLoan);
  indexed(state.temporaries, allocator.nextTemporary);
  const scopes = new Map<number, number>();
  const owners = new Map<number, number>();
  const frameBindings = new Map<number, number>();
  const framePositions = new Map(state.frames.map((frame, index) => [frame.id, index]));
  let liveBytes = 0;
  rustAssert(state.objects.length === allocator.nextObject - 1);
  for (const [index, frame] of state.frames.entries()) {
    rustAssert(nodes.get(frame.functionNode)?.kind === 'function');
    rustAssert(
      index === 0
        ? frame.callNode === null
        : frame.callNode !== null && nodes.get(frame.callNode)?.kind === 'call',
    );
    if (index > 0) {
      const caller = nodes.get(state.frames[index - 1].functionNode)!.byteRange;
      const call = nodes.get(frame.callNode!)!.byteRange;
      rustAssert(caller.start <= call.start && call.end <= caller.end);
    }
    let last = 0;
    for (const id of frame.scopeIds) {
      rustAssert(id > last && id < allocator.nextScope && !scopes.has(id));
      scopes.set(id, frame.id);
      last = id;
    }
  }
  for (const object of state.objects) {
    if (object.kind === 'string') rustAssert(size(object.text) <= 4096);
    if (object.alive)
      liveBytes += object.kind === 'string' ? size(object.text) : object.items.length * 4;
  }
  const checkValue = (type: RustType | null, value: RustValue, owning: boolean) => {
    if (value.kind === 'unit') rustAssert(type === null || type === 'unit');
    if (value.kind === 'i32') rustAssert(type === null || type === 'i32');
    if (value.kind === 'bool') rustAssert(type === null || type === 'bool');
    if (value.kind === 'reference') {
      rustAssert(!owning && type !== null && type.startsWith('&') && loans.has(value.loanId));
    }
    const id = objectValue(value);
    if (id === null) return;
    const object = objects.get(id);
    rustAssert(object);
    rustAssert(
      value.kind === 'string-object'
        ? object.kind === 'string' && (type === null || type === 'String')
        : object.kind === 'array' && (type === null || type === `[i32;${object.items.length}]`),
    );
    if (owning) {
      rustAssert(object.alive);
      owners.set(id, (owners.get(id) ?? 0) + 1);
    }
  };
  for (const binding of state.bindings) {
    rustAssert(frames.has(binding.frameId) && scopes.get(binding.scopeId) === binding.frameId);
    rustAssert(['let', 'param', 'for'].includes(nodes.get(binding.declarationNode)?.kind ?? ''));
    const declaration = nodes.get(binding.declarationNode)!.byteRange;
    const functionRange = nodes.get(frames.get(binding.frameId)!.functionNode)!.byteRange;
    rustAssert(functionRange.start <= declaration.start && declaration.end <= functionRange.end);
    const count = (frameBindings.get(binding.frameId) ?? 0) + 1;
    rustAssert(count <= 128);
    frameBindings.set(binding.frameId, count);
    if (binding.status === 'moved')
      rustAssert(binding.type === 'String' && binding.value.kind === 'string-object');
    checkValue(
      binding.type,
      binding.value,
      binding.status === 'live' && !binding.type.startsWith('&'),
    );
    if (binding.value.kind === 'reference') {
      const loan = loans.get(binding.value.loanId)!;
      rustAssert(
        binding.status === 'live' &&
          loan.parameterBindingId === binding.id &&
          nodes.get(binding.declarationNode)?.kind === 'param',
      );
    }
  }
  for (const temporary of state.temporaries) {
    rustAssert(objectValue(temporary.value) !== null);
    checkValue(temporary.type, temporary.value, true);
  }
  for (const object of state.objects)
    rustAssert((owners.get(object.id) ?? 0) === (object.alive ? 1 : 0));
  const targets = new Map<number, { count: number; mutable: boolean }>();
  for (const loan of state.loans) {
    const target = bindings.get(loan.targetBindingId),
      parameter = bindings.get(loan.parameterBindingId);
    rustAssert(target && parameter && target.status === 'live' && !target.type.startsWith('&'));
    rustAssert(target.type === 'i32' || target.type === 'String');
    rustAssert(
      parameter.type === `&${loan.mutable ? 'mut ' : ''}${target.type}` &&
        parameter.value.kind === 'reference' &&
        parameter.value.loanId === loan.id,
    );
    rustAssert(
      framePositions.get(target.frameId)! < framePositions.get(parameter.frameId)! &&
        (!loan.mutable || target.mutable),
    );
    const prior = targets.get(target.id);
    rustAssert(!prior || (!prior.mutable && !loan.mutable));
    targets.set(target.id, { count: (prior?.count ?? 0) + 1, mutable: loan.mutable });
  }
  if (state.control.returnValue !== null) {
    rustAssert(state.control.returnValue.kind !== 'reference');
    checkValue(null, state.control.returnValue, false);
  }
  rustAssert(state.control.nodeId === null || nodes.has(state.control.nodeId));
  rustAssert(state.control.inputCursor <= size(input));
  const inputBytes = encoder.encode(input);
  rustAssert(
    state.control.inputCursor === inputBytes.length ||
      (inputBytes[state.control.inputCursor] & 0xc0) !== 0x80,
  );
  rustAssert(
    allocator.liveBytes === liveBytes && liveBytes <= 1048576 && size(state.output) <= 16384,
  );
}

/** Check every predecessor before applying any member of an atomic step. */
export function projectRustStep(state: RustState, step: RustStep, forward = true): RustState {
  const prior = forward ? 'before' : 'after',
    after = forward ? 'after' : 'before';
  const seen = new Set<string>();
  for (const change of step.changes) {
    const key = change.component + ('id' in change ? ':' + change.id : '');
    rustAssert(!seen.has(key) && !rustEqual(change.before, change.after));
    seen.add(key);
    if ('id' in change) {
      rustAssert(
        (change.before === null || change.before.id === change.id) &&
          (change.after === null || change.after.id === change.id),
      );
      rustAssert(
        rustEqual(
          state[change.component].find((record) => record.id === change.id) ?? null,
          change[prior],
        ),
      );
    } else rustAssert(rustEqual(state[change.component], change[prior]));
  }
  const next = { ...state };
  const copied = new Set<RustTable>();
  for (const change of step.changes) {
    if ('id' in change) {
      const component = change.component;
      if (!copied.has(component)) {
        Object.assign(next, { [component]: [...state[component]] });
        copied.add(component);
      }
      const table = next[component] as { id: number }[];
      const at = table.findIndex((record) => record.id === change.id);
      const value = change[after];
      if (at >= 0) table.splice(at, 1);
      if (value !== null) {
        const index = table.findIndex((record) => record.id > change.id);
        table.splice(index < 0 ? table.length : index, 0, value);
      }
    } else Object.assign(next, { [change.component]: change[after] });
  }
  return next;
}
function newIds(
  before: readonly { id: number }[],
  after: readonly { id: number }[],
  first: number,
  next: number,
) {
  rustAssert(next >= first);
  const old = new Set(before.map((record) => record.id));
  const created = after.filter((record) => !old.has(record.id));
  rustAssert(
    created.length === next - first &&
      created.every((record, index) => record.id === first + index),
  );
}
function mayWrite(binding: RustBinding, state: RustState) {
  const frame = state.frames.at(-1)?.id;
  const loans = state.loans.filter((loan) => loan.targetBindingId === binding.id);
  if (binding.frameId === frame) return binding.mutable && loans.length === 0;
  return loans.some(
    (loan) =>
      loan.mutable &&
      state.bindings.find((parameter) => parameter.id === loan.parameterBindingId)?.frameId ===
        frame,
  );
}
function validateTransition(before: RustState, after: RustState, step: RustStep) {
  for (const component of Object.keys(tableCounter) as RustTable[]) {
    const counter = tableCounter[component];
    newIds(
      before[component],
      after[component],
      before.allocator[counter],
      after.allocator[counter],
    );
  }
  newIds(before.frames, after.frames, before.allocator.nextFrame, after.allocator.nextFrame);
  const oldScopes = before.frames.flatMap((frame) => frame.scopeIds.map((id) => ({ id })));
  const nextScopes = after.frames.flatMap((frame) => frame.scopeIds.map((id) => ({ id })));
  newIds(oldScopes, nextScopes, before.allocator.nextScope, after.allocator.nextScope);
  rustAssert(after.control.nodeId === step.nodeId);
  rustAssert(
    after.control.inputCursor >= before.control.inputCursor &&
      (step.event === 'input' || after.control.inputCursor === before.control.inputCursor),
  );
  rustAssert(
    after.output.startsWith(before.output) &&
      (step.event === 'output' || after.output === before.output),
  );
  const commonFrames = Math.min(before.frames.length, after.frames.length);
  rustAssert(Math.abs(before.frames.length - after.frames.length) <= 1);
  for (let index = 0; index < commonFrames; index++) {
    const first = before.frames[index],
      second = after.frames[index];
    rustAssert(
      first.id === second.id &&
        first.functionNode === second.functionNode &&
        first.callNode === second.callNode,
    );
    const common = Math.min(first.scopeIds.length, second.scopeIds.length);
    rustAssert(first.scopeIds.slice(0, common).every((id, i) => second.scopeIds[i] === id));
  }
  for (const change of step.changes) {
    if (!('id' in change) || !change.before || !change.after) continue;
    if (change.component === 'bindings') {
      const first = change.before,
        second = change.after;
      rustAssert(
        first.id === second.id &&
          first.name === second.name &&
          first.type === second.type &&
          first.mutable === second.mutable &&
          first.declarationNode === second.declarationNode &&
          first.scopeId === second.scopeId &&
          first.frameId === second.frameId,
      );
      if (first.status === 'live' && second.status === 'moved')
        rustAssert(first.type === 'String' && rustEqual(first.value, second.value));
      else if (
        first.type.startsWith('&') ||
        (first.status === 'moved' && second.status === 'moved')
      )
        rustAssert(rustEqual(first.value, second.value));
      else if (!rustEqual(first.value, second.value) || first.status !== second.status)
        rustAssert(mayWrite(first, before));
    } else if (change.component === 'objects') {
      const first = change.before,
        second = change.after;
      rustAssert(first.kind === second.kind && (first.alive || rustEqual(first, second)));
      if (first.kind === 'array' && second.kind === 'array')
        rustAssert(first.items.length === second.items.length);
      if (first.alive && second.alive && !rustEqual(first, second)) {
        const owner = before.bindings.find(
          (binding) => binding.status === 'live' && objectValue(binding.value) === first.id,
        );
        rustAssert(owner && mayWrite(owner, before));
      }
    } else rustAssert(rustEqual(change.before, change.after));
  }
  rustAssert(after.objects.length >= before.objects.length);
}

export function* verifyRustTrace(
  trace: RustTrace,
  nodes: ReadonlyMap<number, RustNode>,
  input: string,
) {
  rustAssert(rustEqual(trace.initialState, initial));
  rustAssert(trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1);
  let state = trace.initialState;
  let resultBytes = 0;
  let entered = false;
  validateState(state, nodes, input);
  for (let cursor = 0; cursor <= trace.steps.length; cursor++) {
    if (cursor % 128 === 0) {
      const checkpoint = trace.checkpoints[cursor / 128];
      rustAssert(checkpoint.cursor === cursor && rustEqual(checkpoint.state, state));
      if (cursor > 0) resultBytes += size(JSON.stringify(checkpoint));
    }
    if (cursor === trace.steps.length) break;
    const step = trace.steps[cursor];
    rustAssert(step.seq === cursor + 1 && nodes.has(step.nodeId));
    const next = projectRustStep(state, step);
    validateState(next, nodes, input);
    validateTransition(state, next, step);
    rustAssert(rustEqual(projectRustStep(next, step, false), state));
    entered ||= next.frames.length > 0;
    state = next;
    resultBytes += size(JSON.stringify(step));
    rustAssert(resultBytes <= 16777216);
    if (cursor % 32 === 0) yield;
  }
  if (trace.completeness === 'complete') rustAssert(entered && trace.steps.length > 0);
  return {
    state,
    steps: trace.steps.length,
    objects: state.objects.length,
    outputBytes: size(state.output),
    resultBytes,
  };
}

export class Rust2018Player {
  private position = 0;
  private current: RustState;
  constructor(private readonly replay: RustReplay) {
    this.current = structuredClone(replay.trace.initialState);
  }
  get cursor() {
    return this.position;
  }
  get state() {
    return structuredClone(this.current);
  }
  get length() {
    return this.replay.trace.steps.length;
  }
  seek(cursor: number) {
    rustAssert(Number.isInteger(cursor) && cursor >= 0 && cursor <= this.length);
    const checkpoint = this.replay.trace.checkpoints[Math.floor(cursor / 128)];
    if (
      checkpoint &&
      Math.abs(cursor - this.position) > 1 &&
      Math.abs(cursor - this.position) > cursor - checkpoint.cursor
    ) {
      this.current = structuredClone(checkpoint.state);
      this.position = checkpoint.cursor;
    }
    while (this.position < cursor)
      this.current = projectRustStep(this.current, this.replay.trace.steps[this.position++]);
    while (this.position > cursor)
      this.current = projectRustStep(this.current, this.replay.trace.steps[--this.position], false);
    return this.state;
  }
}
