/** Relationship checks over supplied deltas only. No C parser or algorithm lives here. */
import { protocolAssert as ensure, sourceByteBoundaries } from './protocol';
import type {
  ByteRange,
  ExecuteRequest,
  ExecuteResult,
  ExecutionLocation,
  ExecutionNode,
  TraceChange,
  TraceObject,
  TraceRecord,
  TraceState,
  TraceStep,
} from './protocol';

type Work<T> = Generator<void, T, unknown>;
type Nodes = Map<string, ExecutionNode>;
function sameJsonSync(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  if (left.length !== right.length) return false;
  for (const key of left)
    if (
      !Object.hasOwn(b, key) ||
      !sameJsonSync((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
      return false;
  return true;
}
const encoder = new TextEncoder();
const utf8 = (text: string) => (text.length ? encoder.encode(text).length : 0);
const int32 = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= -2147483648 &&
  value <= 2147483647;
function equal(a: unknown, b: unknown): void {
  ensure(sameJsonSync(a, b));
}
const sequence = (id: string) => {
  const number = Number(id.slice(1));
  ensure(Number.isSafeInteger(number) && number > 0);
  return number;
};
function rangeValid(range: ByteRange, points: Set<number>) {
  ensure(range.start <= range.end && points.has(range.start) && points.has(range.end));
}
function locationValid(location: ExecutionLocation, nodes: Nodes, points: Set<number>) {
  if (location.kind === 'source') {
    ensure(location.nodeId ? nodes.has(location.nodeId) : location.byteRange);
    if (location.byteRange) rangeValid(location.byteRange, points);
  } else if (location.anchorNodeId) ensure(nodes.has(location.anchorNodeId));
}
function descendant(id: string, ancestor: string, nodes: Nodes): boolean {
  let current: string | null = id;
  for (let remaining = nodes.size + 1; current && remaining > 0; remaining--) {
    if (current === ancestor) return true;
    current = nodes.get(current)?.parentId ?? null;
  }
  return false;
}
function effective(object: TraceObject, index: number): number | null {
  ensure(index >= 0 && index < object.length);
  let low = 0,
    high = object.cells.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (object.cells[middle].index < index) low = middle + 1;
    else high = middle;
  }
  return object.cells[low]?.index === index ? object.cells[low].value : object.defaultValue;
}
interface StateScratch {
  frames: Set<string>;
  scopes: Map<string, TraceState['scopes'][number]>;
  objectIds: Set<string>;
  scopeObjects: Map<string, number>;
}
function checkState(state: TraceState, nodes: Nodes, scratch: StateScratch): void {
  const { frames, scopes, objectIds, scopeObjects } = scratch;
  frames.clear();
  scopes.clear();
  objectIds.clear();
  scopeObjects.clear();
  for (const frame of state.frames) frames.add(frame.id);
  for (const scope of state.scopes) scopes.set(scope.id, scope);
  ensure(frames.size === state.frames.length && scopes.size === state.scopes.length);
  let live = 0,
    previousEnd = 4096;
  for (const frame of state.frames) {
    ensure(
      frame.parentFrameId === null &&
        nodes.get(frame.functionNodeId)?.kind === 'function' &&
        sequence(frame.id) < state.allocator.nextFrame,
    );
    let scopeIndex = 0;
    for (const scope of state.scopes)
      if (scope.frameId === frame.id) ensure(frame.scopeIds[scopeIndex++] === scope.id);
    ensure(scopeIndex === frame.scopeIds.length);
  }
  for (let i = 0; i < state.scopes.length; i++) {
    const scope = state.scopes[i];
    ensure(
      frames.has(scope.frameId) &&
        nodes.get(scope.nodeId)?.kind === (scope.kind === 'for' ? 'for' : 'block') &&
        sequence(scope.id) < state.allocator.nextScope,
    );
    ensure(
      i === 0
        ? scope.kind === 'main' && scope.parentScopeId === null
        : scope.kind !== 'main' &&
            scope.parentScopeId === state.scopes[i - 1].id &&
            state.scopes[i - 1].frameId === scope.frameId,
    );
  }
  for (const object of state.objects) {
    ensure(!objectIds.has(object.id));
    objectIds.add(object.id);
    const scope = scopes.get(object.scopeId);
    ensure(
      scope &&
        frames.has(object.frameId) &&
        scope.frameId === object.frameId &&
        nodes.get(object.declarationNodeId)?.kind === 'declaration' &&
        sequence(object.id) < state.allocator.nextObject,
    );
    // Compare the exact same per-scope allocation order without building an
    // auxiliary array for every state of both the forward and inverse walk.
    const owned = scopeObjects.get(object.scopeId) ?? 0;
    ensure(scope.objectIds[owned] === object.id);
    scopeObjects.set(object.scopeId, owned + 1);
    ensure(
      object.length > 0 &&
        (object.kind !== 'int' || object.length === 1) &&
        Number.isSafeInteger(object.baseAddress + object.length * 4),
    );
    // Dynamic records retain allocation order. Retired objects are removed,
    // never reordered or allocated again at an old address.
    ensure(
      object.baseAddress >= previousEnd &&
        object.baseAddress + object.length * 4 <= state.allocator.nextAddress,
    );
    previousEnd = object.baseAddress + object.length * 4;
    live += object.length * 4;
    let last = -1;
    for (const cell of object.cells) {
      ensure(
        cell.index > last &&
          cell.index < object.length &&
          int32(cell.value) &&
          cell.value !== object.defaultValue,
      );
      last = cell.index;
    }
  }
  for (const scope of state.scopes)
    ensure(scope.objectIds.length === (scopeObjects.get(scope.id) ?? 0));
  ensure(live === state.allocator.liveBytes && live <= 1048576 && utf8(state.output) <= 16384);
  ensure(state.control.nextNodeId === null || nodes.has(state.control.nextNodeId));
  for (const flow of state.control.flowStack) {
    ensure(nodes.has(flow.nodeId));
  }
  const control = state.control;
  if (control.phase === 'ready')
    ensure(
      state.frames.length === 0 &&
        state.scopes.length === 0 &&
        state.objects.length === 0 &&
        control.activeFrameId === null &&
        control.returnValue === null &&
        control.flowStack.length === 0,
    );
  if (control.phase === 'running')
    ensure(
      state.frames.length === 1 &&
        state.scopes.length > 0 &&
        state.frames[0].id === 'f1' &&
        control.activeFrameId === 'f1' &&
        control.returnValue === null,
    );
  if (control.phase === 'returned')
    ensure(
      state.frames.length === 0 &&
        state.scopes.length === 0 &&
        state.objects.length === 0 &&
        control.activeFrameId === null &&
        control.nextNodeId === null &&
        int32(control.returnValue) &&
        control.flowStack.length === 0,
    );
}
function apply(state: TraceState, change: TraceChange, reverse = false): TraceState {
  if (change.op === 'record') {
    const before = reverse ? change.after : change.before,
      after = reverse ? change.before : change.after;
    const table: TraceRecord[] = state[change.table],
      array = table.slice();
    ensure(before !== null || after !== null);
    ensure(change.index <= array.length);
    if (before === null) {
      for (const record of array) {
        ensure(record.id !== change.id);
      }
    } else equal(array[change.index], before);
    ensure(
      (before === null || before.id === change.id) && (after === null || after.id === change.id),
    );
    if (before && after) {
      const fields =
        change.table === 'objects'
          ? [
              'id',
              'declarationNodeId',
              'frameId',
              'scopeId',
              'name',
              'kind',
              'length',
              'baseAddress',
            ]
          : change.table === 'frames'
            ? ['id', 'functionNodeId', 'parentFrameId']
            : ['id', 'frameId', 'parentScopeId', 'nodeId', 'kind'];
      for (const field of fields)
        equal(
          (before as unknown as Record<string, unknown>)[field],
          (after as unknown as Record<string, unknown>)[field],
        );
    }
    if (before === null) array.splice(change.index, 0, after!);
    else if (after === null) array.splice(change.index, 1);
    else array[change.index] = after;
    if (change.table === 'frames') state.frames = array as TraceState['frames'];
    else if (change.table === 'scopes') state.scopes = array as TraceState['scopes'];
    else state.objects = array as TraceState['objects'];
    return state;
  }
  if (change.op === 'cell') {
    let position = -1;
    for (let i = 0; i < state.objects.length; i++) {
      if (state.objects[i].id === change.objectId) {
        position = i;
        break;
      }
    }
    ensure(position >= 0);
    const object = state.objects[position],
      before = reverse ? change.after : change.before,
      after = reverse ? change.before : change.after;
    ensure(effective(object, change.index) === before);
    const cells: TraceObject['cells'] = [];
    let inserted = false;
    for (const cell of object.cells) {
      if (!inserted && cell.index >= change.index) {
        if (after !== object.defaultValue) {
          ensure(int32(after));
          cells.push({ index: change.index, value: after });
        }
        inserted = true;
      }
      if (cell.index !== change.index) cells.push(cell);
    }
    if (!inserted && after !== object.defaultValue) {
      ensure(int32(after));
      cells.push({ index: change.index, value: after });
    }
    const objects = state.objects.slice();
    objects[position] = { ...object, cells };
    state.objects = objects;
    return state;
  }
  if (change.op === 'output') {
    ensure(change.afterBytes - change.beforeBytes === utf8(change.append));
    let output: string;
    if (reverse) {
      ensure(utf8(state.output) === change.afterBytes && state.output.endsWith(change.append));
      output = change.append.length ? state.output.slice(0, -change.append.length) : state.output;
      ensure(utf8(output) === change.beforeBytes);
    } else {
      ensure(utf8(state.output) === change.beforeBytes);
      output = state.output + change.append;
      ensure(utf8(output) === change.afterBytes);
    }
    state.output = output;
    return state;
  }
  equal(state[change.op], reverse ? change.after : change.before);
  if (change.op === 'control') state.control = reverse ? change.before : change.after;
  else if (change.op === 'allocator') state.allocator = reverse ? change.before : change.after;
  else state.counters = reverse ? change.before : change.after;
  return state;
}
/** Project an already validated atomic step without mutating its input state or deltas. */
export function projectTraceStep(state: TraceState, step: TraceStep, reverse = false): TraceState {
  let next = { ...state };
  if (reverse) {
    for (let i = step.changes.length - 1; i >= 0; i--) next = apply(next, step.changes[i], true);
  } else {
    for (const change of step.changes) next = apply(next, change);
  }
  return next;
}

interface Write {
  object: string;
  index: number;
  before: number | null;
  after: number | null;
}
function transition(
  step: TraceStep,
  before: TraceState,
  after: TraceState,
  writes: Map<number, Write>,
): { scalarWrites: number; arrayWrites: number } {
  let scalarWrites = 0,
    arrayWrites = 0,
    cells = 0,
    initializations = 0,
    objects = 0,
    scopes = 0,
    frames = 0,
    allocated = 0,
    deletedObjects = 0,
    deletedScopes = 0,
    deletedFrames = 0;
  for (const change of step.changes) {
    if (change.op === 'cell') {
      ensure(step.kind === 'value.initialize' || step.kind === 'value.write');
      const object = before.objects.find((object) => object.id === change.objectId);
      ensure(object && change.after !== null);
      if (step.kind === 'value.initialize') ensure(change.before === null && object.kind === 'int');
      if (object.kind === 'int') scalarWrites++;
      else arrayWrites++;
      cells++;
      if (step.kind === 'value.write')
        writes.set(step.seq, {
          object: object.id,
          index: change.index,
          before: change.before,
          after: change.after,
        });
    } else if (change.op === 'record') {
      if (change.before === null) {
        ensure(change.after);
        if (change.table === 'objects') {
          const object = change.after as TraceObject;
          ensure(
            step.kind === 'object.declare' &&
              object.defaultValue === null &&
              object.cells.length === 0,
          );
          ensure(
            sequence(object.id) === before.allocator.nextObject + objects &&
              object.baseAddress === before.allocator.nextAddress + allocated,
          );
          objects++;
          allocated += object.length * 4;
        } else if (change.table === 'scopes') {
          ensure(step.kind === 'program.enter' || step.kind === 'scope.enter');
          ensure(sequence(change.id) === before.allocator.nextScope + scopes);
          scopes++;
        } else {
          ensure(
            step.kind === 'program.enter' &&
              sequence(change.id) === before.allocator.nextFrame + frames,
          );
          frames++;
        }
      } else if (change.after === null) {
        ensure(['scope.exit', 'control.jump', 'program.return'].includes(step.kind));
        if (change.table === 'objects') deletedObjects++;
        else if (change.table === 'scopes') deletedScopes++;
        else {
          ensure(step.kind === 'program.return');
          deletedFrames++;
        }
      } else if (change.table === 'objects') {
        const previous = change.before as TraceObject,
          next = change.after as TraceObject;
        ensure(
          step.kind === 'value.initialize' &&
            previous.kind === 'int-array' &&
            previous.defaultValue === null &&
            previous.cells.length === 0 &&
            next.defaultValue === 0,
        );
        initializations++;
        arrayWrites += next.length;
      }
    } else if (change.op === 'output') ensure(step.kind === 'output.append');
  }
  for (const [field, delta] of [
    ['nextObject', objects],
    ['nextScope', scopes],
    ['nextFrame', frames],
    ['nextAddress', allocated],
  ] as const)
    ensure(after.allocator[field] === before.allocator[field] + delta);
  switch (step.kind) {
    case 'program.enter':
      ensure(
        before.control.phase === 'ready' &&
          after.control.phase === 'running' &&
          frames === 1 &&
          scopes === 1 &&
          objects === 0 &&
          after.scopes[0]?.kind === 'main',
      );
      break;
    case 'object.declare':
      ensure(objects === 1 && cells === 0 && initializations === 0);
      break;
    case 'value.initialize':
      ensure(cells + initializations === 1);
      break;
    case 'value.write':
      ensure(cells === 1 && initializations === 0);
      break;
    case 'scope.enter':
      ensure(scopes === 1 && objects === 0 && frames === 0);
      break;
    case 'scope.exit':
      ensure(
        deletedScopes === 1 &&
          deletedFrames === 0 &&
          before.scopes.length >= 2 &&
          after.scopes.length + 1 === before.scopes.length &&
          before.scopes.at(-1)?.kind !== 'main',
      );
      equal(before.scopes.slice(0, after.scopes.length), after.scopes);
      break;
    case 'program.return':
      ensure(
        before.control.phase === 'running' &&
          after.control.phase === 'returned' &&
          deletedFrames === 1 &&
          deletedScopes > 0,
      );
      break;
    case 'control.jump':
      ensure(deletedFrames === 0);
      break;
    default:
      ensure(
        frames +
          scopes +
          objects +
          deletedObjects +
          deletedScopes +
          deletedFrames +
          cells +
          initializations ===
          0,
      );
  }
  if (step.kind !== 'program.enter' && step.kind !== 'program.return')
    ensure(before.control.phase === 'running' && after.control.phase === 'running');
  return { scalarWrites, arrayWrites };
}
function observations(
  step: TraceStep,
  state: TraceState,
  nodes: Nodes,
  writes: Map<number, Write>,
  swapWrites: Set<number>,
): { comparisons: number; swaps: number } {
  let comparisons = 0,
    swaps = 0,
    decisions = 0;
  // Only short-circuit pairing needs an index. Most steps have none; retain
  // the exact occurrence counts without allocating per-node observation lists.
  let short: Map<string, number> | undefined, evaluates: Map<string, number> | undefined;
  if (step.observations.some((observation) => observation.kind === 'short-circuit')) {
    short = new Map();
    evaluates = new Map();
    for (const observation of step.observations) {
      if (observation.kind === 'short-circuit')
        short.set(observation.nodeId, (short.get(observation.nodeId) ?? 0) + 1);
      else if (
        observation.kind === 'evaluate' &&
        (observation.operator === '&&' || observation.operator === '||') &&
        observation.operands.length === 1
      )
        evaluates.set(observation.nodeId, (evaluates.get(observation.nodeId) ?? 0) + 1);
    }
  }
  for (const observation of step.observations) {
    ensure(nodes.has(observation.nodeId));
    if (observation.kind === 'read') {
      const object = state.objects.find((object) => object.id === observation.objectId);
      ensure(object && effective(object, observation.index) === observation.value);
    } else if (observation.kind === 'decision') {
      decisions++;
      ensure(
        step.kind === 'condition' &&
          observation.branch === (observation.value === 0 ? 'false' : 'true'),
      );
    } else if (observation.kind === 'evaluate') {
      if (['<', '<=', '>', '>=', '==', '!='].includes(observation.operator)) comparisons++;
      if (observation.operator === '&&' || observation.operator === '||') {
        if (observation.operands.length === 1)
          ensure(
            short?.get(observation.nodeId) === 1 &&
              (observation.operator === '&&'
                ? observation.operands[0] === 0
                : observation.operands[0] !== 0),
          );
        else ensure(!short?.has(observation.nodeId));
      }
    } else if (observation.kind === 'short-circuit') {
      ensure(
        nodes.has(observation.skippedNodeId) &&
          observation.skippedNodeId !== observation.nodeId &&
          descendant(observation.skippedNodeId, observation.nodeId, nodes) &&
          short?.get(observation.nodeId) === 1,
      );
      ensure(evaluates?.get(observation.nodeId) === 1);
      for (const other of step.observations) {
        ensure(!descendant(other.nodeId, observation.skippedNodeId, nodes));
      }
    } else {
      const [first, second] = observation.writeSeqs,
        [left, right] = observation.indices,
        [leftValue, rightValue] = observation.beforeValues;
      const a = writes.get(first),
        b = writes.get(second);
      ensure(
        step.kind === 'value.write' &&
          first < second &&
          second === step.seq &&
          left !== right &&
          !swapWrites.has(first) &&
          !swapWrites.has(second),
      );
      ensure(
        a &&
          b &&
          a.object === observation.objectId &&
          b.object === observation.objectId &&
          a.index === left &&
          b.index === right &&
          a.before === leftValue &&
          b.before === rightValue &&
          a.after === rightValue &&
          b.after === leftValue,
      );
      for (let sequence = first + 1; sequence < second; sequence++) {
        const write = writes.get(sequence);
        ensure(
          !write || write.object !== a.object || (write.index !== left && write.index !== right),
        );
      }
      swapWrites.add(first);
      swapWrites.add(second);
      swaps++;
    }
  }
  ensure(decisions === (step.kind === 'condition' ? 1 : 0));
  return { comparisons, swaps };
}
function judgeBeforeStep(
  result: ExecuteResult,
  request: ExecuteRequest,
  step: TraceStep,
  before: TraceState,
  nodes: Nodes,
  points: Set<number>,
): void {
  for (const observation of result.judgeResult?.observations ?? []) {
    if (observation.beforeCursor !== step.seq - 1) continue;
    locationValid(observation.location, nodes, points);
    equal(observation.location, step.location);
    const object = before.objects.find((object) => object.id === observation.objectId),
      binding = result.resolvedBindings.find(
        (binding) => binding.bindingKey === observation.bindingKey,
      );
    ensure(
      object &&
        object.kind === 'int-array' &&
        binding &&
        binding.declarationNodeId === object.declarationNodeId &&
        observation.declarationNodeId === object.declarationNodeId &&
        observation.values.length <= object.length,
    );
    for (let i = 0; i < observation.values.length; i++) {
      ensure(observation.values[i] === effective(object, i));
    }
    ensure(
      step.changes.some(
        (change) =>
          change.op === 'record' &&
          change.table === 'objects' &&
          change.id === object.id &&
          change.after === null,
      ),
    );
    if (result.judgeResult?.status === 'met' && request.judge?.expectedArray)
      equal(observation.values, request.judge.expectedArray);
  }
}
function judgeResult(
  result: ExecuteResult,
  request: ExecuteRequest,
  final: TraceState,
  nodes: Nodes,
  points: Set<number>,
): void {
  const judge = result.judgeResult;
  if (request.mode !== 'exercise-test') {
    ensure(judge === null);
    return;
  }
  if (!judge) {
    ensure(result.terminal.status !== 'completed');
    return;
  }
  ensure(request.judge && judge.caseKey === request.identity.testCaseKey, 'E_PROTOCOL_INVALID');
  equal(judge.profileRef, request.judge.profileRef);
  const keys = ['input-bindings', 'stdout-exact', 'exit-zero', 'teaching-target'];
  if (request.judge.rule === 'while-for-accumulations')
    keys.push('while-accumulation', 'for-accumulation');
  ensure(
    sameJsonSync(judge.checks.map((check) => check.key).sort(), keys.sort()),
    'E_PROTOCOL_INVALID',
  );
  const allMet = judge.checks.every((check) => check.status === 'met');
  ensure((judge.status === 'met') === allMet, 'E_PROTOCOL_INVALID');
  if (judge.status === 'met')
    ensure(
      result.terminal.status === 'completed' &&
        result.terminal.exitCode === 0 &&
        final.output === request.judge.expectedStdout,
      'E_PROTOCOL_INVALID',
    );
  for (const check of judge.checks) {
    for (const id of check.nodeIds) ensure(nodes.has(id));
    for (const sequence of check.stepSeqs)
      ensure(sequence > 0 && sequence <= result.trace!.steps.length);
  }
  const coverageKeys = new Set<string>(),
    siteNodes = new Map<string, string>(),
    nodeSites = new Map<string, string>();
  const structuralIfs =
    request.protocolVersion === '1.1.0'
      ? [...nodes.values()].filter((node) => node.kind === 'if')
      : [];
  for (const item of judge.coverage) {
    const node = nodes.get(item.nodeId),
      mapping = request.source.blockMap.find((mapping) => mapping.blockId === item.siteKey);
    if (request.protocolVersion === '1.1.0') {
      const ordinal = structuralIfs.findIndex((entry) => entry.nodeId === item.nodeId);
      ensure(
        node &&
          ordinal >= 0 &&
          item.siteKey === `if.${ordinal}` &&
          ['then', 'else'].includes(item.branch),
      );
    } else {
      ensure(
        node &&
          mapping &&
          node.kind === (item.branch === 'then' || item.branch === 'else' ? 'if' : item.branch),
      );
      equal(node.byteRange, mapping.byteRange);
    }
    const key = `${item.siteKey}:${item.branch}`;
    ensure(!coverageKeys.has(key));
    coverageKeys.add(key);
    ensure(!siteNodes.has(item.siteKey) || siteNodes.get(item.siteKey) === item.nodeId);
    siteNodes.set(item.siteKey, item.nodeId);
    ensure(!nodeSites.has(item.nodeId) || nodeSites.get(item.nodeId) === item.siteKey);
    nodeSites.set(item.nodeId, item.siteKey);
  }
  for (const observation of judge.observations) {
    ensure(observation.beforeCursor < result.trace!.steps.length);
    locationValid(observation.location, nodes, points);
  }
  if (judge.status === 'met' && request.judge.rule === 'single-index-increment')
    ensure(
      request.judge.expectedArray !== undefined &&
        judge.observations.length === 1 &&
        judge.observations[0].bindingKey === 'param.values' &&
        Array.isArray(request.input.values.values) &&
        judge.observations[0].values.length === request.input.values.values.length,
      'E_PROTOCOL_INVALID',
    );
}
export function* validateTraceRelationships(
  result: ExecuteResult,
  request: ExecuteRequest,
): Work<void> {
  const points = sourceByteBoundaries(request.source.text),
    nodes: Nodes = new Map();
  const ancestry: string[] = [];
  for (let i = 0; i < result.nodeMap.length; i++) {
    yield;
    const node = result.nodeMap[i];
    ensure(node.nodeId === `n${i + 1}`);
    rangeValid(node.byteRange, points);
    if (node.parentId === null) ensure(i === 0 && node.kind === 'function');
    else {
      while (ancestry.length && ancestry.at(-1) !== node.parentId) ancestry.pop();
      ensure(ancestry.at(-1) === node.parentId);
      const parent = nodes.get(node.parentId);
      ensure(
        parent &&
          parent.byteRange.start <= node.byteRange.start &&
          parent.byteRange.end >= node.byteRange.end &&
          node.kind !== 'function',
      );
    }
    nodes.set(node.nodeId, node);
    ancestry.push(node.nodeId);
  }
  locationValid(result.terminal.location, nodes, points);
  for (const diagnostic of result.terminal.diagnostics) {
    yield;
    locationValid(diagnostic.location, nodes, points);
    for (const nodeId of diagnostic.details.relatedNodeIds ?? []) ensure(nodes.has(nodeId));
  }
  const seenBindings = new Set<string>();
  for (const binding of result.resolvedBindings) {
    yield;
    ensure(!seenBindings.has(binding.bindingKey));
    seenBindings.add(binding.bindingKey);
    const node = nodes.get(binding.declarationNodeId),
      mapping = request.source.bindingMap.find(
        (mapping) => mapping.bindingKey === binding.bindingKey,
      );
    ensure(node?.kind === 'declaration' && mapping);
    equal(node.byteRange, mapping.byteRange);
  }
  const trace = result.trace;
  if (!trace) {
    ensure(
      result.terminal.cursor === null &&
        result.terminal.exitCode === null &&
        result.terminal.status !== 'completed' &&
        result.judgeResult === null,
    );
    return;
  }
  ensure(trace.dslVersion === '1.0.0', 'E_PROTOCOL_VERSION');
  ensure(
    result.producer === 'rust' &&
      nodes.get(trace.initialState.control.nextNodeId!)?.kind === 'function',
  );
  // Each validation owns its scratch tables, including interleaved generators.
  // They retain no accepted state and are cleared before every complete check.
  const scratch: StateScratch = {
    frames: new Set(),
    scopes: new Map(),
    objectIds: new Set(),
    scopeObjects: new Map(),
  };
  checkState(trace.initialState, nodes, scratch);
  ensure(trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1);
  for (let i = 0; i < trace.checkpoints.length; i++) {
    yield;
    ensure(trace.checkpoints[i].cursor === i * 128);
  }
  equal(trace.checkpoints[0].state, trace.initialState);
  // Keep only the current immutable projection. No state-per-step expansion.
  let state = trace.initialState,
    peak = 0;
  const writes = new Map<number, Write>(),
    swapWrites = new Set<number>();
  for (let at = 0; at < trace.steps.length; at++) {
    yield;
    const step = trace.steps[at];
    ensure(step.seq === at + 1);
    locationValid(step.location, nodes, points);
    if (step.location.kind === 'synthetic')
      ensure(step.kind === 'program.return' && step.location.reason === 'implicit-return');
    const before = state;
    state = { ...state };
    judgeBeforeStep(result, request, step, before, nodes, points);
    for (const change of step.changes) state = apply(state, change);
    checkState(state, nodes, scratch);
    const writeCounts = transition(step, before, state, writes),
      observationCounts = observations(step, before, nodes, writes, swapWrites);
    ensure(state.counters.scalarWrites === before.counters.scalarWrites + writeCounts.scalarWrites);
    ensure(state.counters.arrayWrites === before.counters.arrayWrites + writeCounts.arrayWrites);
    ensure(
      state.counters.comparisons === before.counters.comparisons + observationCounts.comparisons,
    );
    ensure(state.counters.swaps === before.counters.swaps + observationCounts.swaps);
    peak = Math.max(peak, state.allocator.liveBytes);
    if (step.seq % 128 === 0) equal(trace.checkpoints[step.seq / 128].state, state);
  }
  ensure(result.terminal.cursor === trace.steps.length);
  if (result.terminal.status === 'completed')
    ensure(
      trace.completeness === 'complete' &&
        trace.steps.at(-1)?.kind === 'program.return' &&
        state.control.phase === 'returned' &&
        result.terminal.exitCode === state.control.returnValue,
    );
  else
    ensure(
      trace.completeness === 'prefix' &&
        state.control.phase !== 'returned' &&
        result.terminal.exitCode === null,
    );
  if (result.stats) ensure(result.stats.peakVirtualBytes === peak);
  // Accepted trace requires all requested declarations to resolve. Early rejects
  // may have no node table or resolved mappings at all.
  equal(
    [...seenBindings].sort(),
    request.source.bindingMap.map((mapping) => mapping.bindingKey).sort(),
  );
  judgeResult(result, request, state, nodes, points);
  // Verify the complete inverse sequence against checkpoints and initial state.
  // Each inverse checks its own exact preconditions before restoring records.
  state = { ...state };
  for (let at = trace.steps.length - 1; at >= 0; at--) {
    yield;
    const step = trace.steps[at];
    for (let i = step.changes.length - 1; i >= 0; i--) state = apply(state, step.changes[i], true);
    checkState(state, nodes, scratch);
    if (at % 128 === 0) equal(state, trace.checkpoints[at / 128].state);
  }
  equal(state, trace.initialState);
}
