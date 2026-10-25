import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// This checks authored protocol fixtures. It does not parse or execute C.
const contractDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../契约');
const fail = (code, detail) => { throw Object.assign(new Error(detail), { code }); };
const ensure = (value, detail, code = 'E_TRACE_INVALID') => { if (!value) fail(code, detail); };
const equal = (a, b, detail, code) => ensure(isDeepStrictEqual(a, b), detail, code);
const clone = value => structuredClone(value);
const utf8 = value => Buffer.byteLength(value, 'utf8');
const safeInt = value => Number.isSafeInteger(value);
const int32 = value => safeInt(value) && value >= -2147483648 && value <= 2147483647;

function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = value.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    ensure(safeInt(value), 'Noninteger protocol value', 'E_PROTOCOL_INVALID');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    ensure(validUnicode(value), 'Invalid Unicode string', 'E_PROTOCOL_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  ensure(value && typeof value === 'object', 'Invalid JSON type', 'E_PROTOCOL_INVALID');
  const keys = Object.keys(value).sort();
  ensure(keys.every(k => /^[\x20-\x7e]+$/.test(k)), 'Non-ASCII key', 'E_PROTOCOL_INVALID');
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function strictJson(text, wire = false) {
  let at = 0;
  const invalid = detail => fail('E_PROTOCOL_INVALID', detail);
  const space = () => { while (/[ \t\r\n]/.test(text[at] || '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, at)); } catch { invalid('Invalid string'); }
        if (!validUnicode(value)) invalid('Unpaired surrogate');
        return value;
      }
    }
    invalid('Unclosed string');
  }
  function value(depth = 0) {
    space();
    const c = text[at];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      if (depth + 1 > 32) invalid('JSON container depth');
      const object = c === '{';
      const out = object ? Object.create(null) : [];
      const keys = new Set();
      at++; space();
      if (text[at] === (object ? '}' : ']')) { at++; return out; }
      while (at < text.length) {
        let key;
        if (object) {
          if (text[at] !== '"') invalid('Object key required');
          key = string();
          if (keys.has(key)) invalid('Duplicate object key');
          keys.add(key); space();
          if (text[at++] !== ':') invalid('Colon required');
        }
        const item = value(depth + 1);
        if (object) out[key] = item; else out.push(item);
        space();
        if (text[at] === (object ? '}' : ']')) { at++; return out; }
        if (text[at++] !== ',') invalid('Comma required');
        space();
      }
      invalid('Unclosed container');
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, at)) { at += word.length; return result; }
    }
    const match = /^-?(0|[1-9][0-9]*)/.exec(text.slice(at));
    if (!match) invalid('Invalid JSON value');
    at += match[0].length;
    const number = Number(match[0]);
    if (!safeInt(number)) invalid('Unsafe integer');
    return number;
  }
  const result = value(); space();
  if (at !== text.length) invalid('Trailing or noninteger JSON');
  let ordinary;
  try { ordinary = JSON.parse(text); } catch { invalid('Invalid JSON syntax'); }
  if (wire && canonical(ordinary) !== text) invalid('Noncanonical encoding');
  return ordinary;
}

const read = name => strictJson(fs.readFileSync(path.join(contractDir, name), 'utf8'));
const normal = read('02.2-正常轨迹样例.json');
const failure = read('02.2-失败与超限轨迹样例.json');
const scenarios = read('02.2-异常与恢复场景.json');
const content = read('02.1-内容样例.json');
const fixtures = [...normal.fixtures, ...failure.fixtures];
const stepsAllowed = new Set(['program.enter', 'object.declare', 'value.initialize', 'value.write', 'condition', 'scope.enter', 'scope.exit', 'output.append', 'control.jump', 'program.return', 'nop']);
const reasons = new Set(['initial-state', 'implicit-return', 'pre-execution', 'adapter-cancel', 'adapter-deadline', 'module-load', 'worker-failure', 'protocol-validation', 'encoding-failure']);

function bytePoints(source) {
  const points = new Map();
  let byteOffset = 0, utf16Offset = 0, line = 1, column = 1;
  points.set(0, { line, column, utf16Offset });
  while (utf16Offset < source.length) {
    const code = source.codePointAt(utf16Offset);
    const c = String.fromCodePoint(code);
    if (c === '\r' && source[utf16Offset + 1] === '\n') {
      byteOffset += 2; utf16Offset += 2; line++; column = 1;
    } else {
      byteOffset += utf8(c); utf16Offset += c.length;
      if (c === '\n' || c === '\r') { line++; column = 1; } else column++;
    }
    points.set(byteOffset, { line, column, utf16Offset });
  }
  return points;
}

function verifyPair(fixture) {
  const request = fixture.request, result = fixture.result;
  ensure(['completed', 'program-error', 'rejected', 'resource-limit', 'cancelled', 'infrastructure-failure'].includes(result.terminal.status), 'Unknown terminal status', 'E_PROTOCOL_INVALID');
  for (const key of ['protocolVersion', 'traceVersion', 'diagnosticVersion', 'judgeVersion', 'encodingVersion']) {
    ensure(request[key] === '1.0.0' && result[key] === '1.0.0', 'Unknown version', 'E_PROTOCOL_VERSION');
  }
  if (result.trace) ensure(result.trace.dslVersion === '1.0.0', 'Unknown DSL', 'E_PROTOCOL_VERSION');
  for (const key of ['identity', 'engineRef', 'packageRef', 'languageRef', 'subsetRef', 'programRef', 'subjectRef', 'learningRevision', 'budgetRef']) {
    equal(result[key], request[key], `Identity/reference mismatch: ${key}`, 'E_PROTOCOL_INVALID');
  }
  ensure(utf8(request.source.text) <= 32768 && utf8(canonical(request)) <= 65536, 'Request budget', 'E_PROTOCOL_INVALID');
  ensure(utf8(canonical(result)) <= 16777216, 'Result budget', 'E_PROTOCOL_INVALID');
  ensure(result.producer !== 'adapter' || (result.trace === null && result.stats === null && result.judgeResult === null && result.terminal.status !== 'completed'), 'Adapter fabricated result', 'E_PROTOCOL_INVALID');
  ensure(result.producer !== 'fixture' || result.stats === null || result.stats.rustMicros === null, 'Fixture fabricated timing', 'E_PROTOCOL_INVALID');

  const points = bytePoints(request.source.text);
  const nodes = new Map();
  result.nodeMap.forEach((n, i) => {
    ensure(n.nodeId === `n${i + 1}` && !nodes.has(n.nodeId), 'Node identity/order');
    ensure(n.byteRange.start <= n.byteRange.end && points.has(n.byteRange.start) && points.has(n.byteRange.end), 'Source range');
    if (n.parentId !== null) {
      const parent = nodes.get(n.parentId);
      ensure(parent && parent.byteRange.start <= n.byteRange.start && parent.byteRange.end >= n.byteRange.end, 'Node parent range');
    }
    nodes.set(n.nodeId, n);
  });
  const locate = (location, code = 'E_TRACE_INVALID') => {
    if (location.kind === 'source') {
      ensure(location.nodeId ? nodes.has(location.nodeId) : Boolean(location.byteRange), 'Missing location', code);
      if (location.byteRange) ensure(points.has(location.byteRange.start) && points.has(location.byteRange.end) && location.byteRange.start <= location.byteRange.end, 'Invalid direct range', code);
      if (location.nodeId) ensure(['start', 'whole', 'end'].includes(location.edge), 'Invalid location edge', code);
    } else ensure(location.kind === 'synthetic' && reasons.has(location.reason) && (!location.anchorNodeId || nodes.has(location.anchorNodeId)), 'Unknown synthetic location', code);
  };
  locate(result.terminal.location, 'E_PROTOCOL_INVALID');
  result.terminal.diagnostics.forEach(d => locate(d.location, 'E_PROTOCOL_INVALID'));
  const unique = (array, key) => new Set(array.map(x => x[key])).size === array.length;
  ensure(unique(request.source.blockMap, 'blockId') && unique(request.source.bindingMap, 'bindingKey') && unique(result.resolvedBindings, 'bindingKey'), 'Duplicate source binding');
  for (const mapping of [...request.source.blockMap, ...request.source.bindingMap]) ensure(points.has(mapping.byteRange.start) && points.has(mapping.byteRange.end) && mapping.byteRange.start <= mapping.byteRange.end, 'Mapping range');
  for (const binding of result.resolvedBindings) {
    const node = nodes.get(binding.declarationNodeId);
    const mapping = request.source.bindingMap.find(x => x.bindingKey === binding.bindingKey);
    ensure(node?.kind === 'declaration' && mapping && isDeepStrictEqual(node.byteRange, mapping.byteRange), 'Binding declaration');
  }

  const trace = result.trace;
  if (!trace) {
    ensure(result.terminal.cursor === null && result.terminal.exitCode === null && result.terminal.status !== 'completed', 'Invalid null trace', 'E_PROTOCOL_INVALID');
    ensure(result.judgeResult === null, 'Null trace has judge success', 'E_PROTOCOL_INVALID');
    return { steps: 0, states: [], requestsBytes: utf8(canonical(request)), resultBytes: utf8(canonical(result)) };
  }

  function validateState(state) {
    ensure(['ready', 'running', 'returned'].includes(state.control.phase), 'Control phase');
    ensure(unique(state.objects, 'id') && unique(state.scopes, 'id') && unique(state.frames, 'id'), 'Duplicate state ID');
    const objects = new Map(state.objects.map(x => [x.id, x]));
    const scopes = new Map(state.scopes.map(x => [x.id, x]));
    const frames = new Map(state.frames.map(x => [x.id, x]));
    ensure(state.frames.length <= 1 && state.scopes.length <= 64, 'P0 frame/scope limit');
    for (const frame of state.frames) {
      ensure(frame.parentFrameId === null && nodes.get(frame.functionNodeId)?.kind === 'function', 'P0 main frame');
      equal(frame.scopeIds, state.scopes.filter(s => s.frameId === frame.id).map(s => s.id), 'Frame scopes');
    }
    for (const scope of state.scopes) {
      ensure(frames.has(scope.frameId) && nodes.has(scope.nodeId) && (!scope.parentScopeId || scopes.has(scope.parentScopeId)), 'Scope references');
      const seen = new Set([scope.id]);
      let parent = scope.parentScopeId;
      while (parent) { ensure(!seen.has(parent), 'Scope cycle'); seen.add(parent); parent = scopes.get(parent).parentScopeId; }
      equal(scope.objectIds, state.objects.filter(o => o.scopeId === scope.id).map(o => o.id), 'Scope objects');
    }
    const addressRanges = [];
    for (const object of state.objects) {
      ensure(scopes.has(object.scopeId) && frames.has(object.frameId) && scopes.get(object.scopeId).frameId === object.frameId && nodes.get(object.declarationNodeId)?.kind === 'declaration', 'Object references');
      ensure(safeInt(object.length) && object.length > 0 && (object.kind !== 'int' || object.length === 1), 'Object length');
      ensure(object.defaultValue === null || int32(object.defaultValue), 'Default cell');
      let last = -1;
      for (const cell of object.cells) { ensure(cell.index > last && cell.index < object.length && int32(cell.value) && cell.value !== object.defaultValue, 'Sparse cells'); last = cell.index; }
      ensure(object.baseAddress >= 4096 && object.baseAddress % 4 === 0 && object.baseAddress + object.length * 4 <= state.allocator.nextAddress, 'Virtual address');
      addressRanges.push([object.baseAddress, object.baseAddress + object.length * 4]);
    }
    addressRanges.sort((a, b) => a[0] - b[0]);
    addressRanges.forEach((r, i) => ensure(i === 0 || addressRanges[i - 1][1] <= r[0], 'Overlapping objects'));
    const live = state.objects.reduce((n, o) => n + 4 * o.length, 0);
    ensure(live === state.allocator.liveBytes && live <= 1048576 && utf8(state.output) <= 16384, 'State byte budgets');
    ensure(!state.control.nextNodeId || nodes.has(state.control.nextNodeId), 'Control node');
    ensure(!state.control.activeFrameId || frames.has(state.control.activeFrameId), 'Active frame');
    state.control.flowStack.forEach(x => ensure(nodes.has(x.nodeId), 'Flow node'));
    Object.values(state.counters).forEach(x => ensure(safeInt(x) && x >= 0, 'Counter'));
    if (state.control.phase === 'returned') ensure(objects.size === 0 && scopes.size === 0 && frames.size === 0 && state.control.activeFrameId === null && state.control.nextNodeId === null && int32(state.control.returnValue), 'Returned state');
    if (state.control.phase === 'running') ensure(frames.size === 1 && state.control.activeFrameId === 'f1', 'Running state');
  }

  function apply(state, change, reverse = false) {
    if (change.op === 'record') {
      ensure(['frames', 'scopes', 'objects'].includes(change.table), 'Record table');
      const array = state[change.table], before = reverse ? change.after : change.before, after = reverse ? change.before : change.after;
      ensure(before !== null || after !== null, 'Empty record change');
      ensure(safeInt(change.index) && change.index >= 0 && change.index <= array.length, 'Record position');
      if (before === null) ensure(!array.some(x => x.id === change.id), 'Duplicate creation');
      else equal(array[change.index], before, 'Record before');
      ensure((before === null || before.id === change.id) && (after === null || after.id === change.id), 'Record identity');
      if (before === null) array.splice(change.index, 0, clone(after));
      else if (after === null) array.splice(change.index, 1);
      else array[change.index] = clone(after);
    } else if (change.op === 'cell') {
      const object = state.objects.find(x => x.id === change.objectId);
      ensure(object && safeInt(change.index) && change.index >= 0 && change.index < object.length, 'Cell reference/index');
      const before = reverse ? change.after : change.before, after = reverse ? change.before : change.after;
      equal(object.cells.find(x => x.index === change.index)?.value ?? object.defaultValue, before, 'Cell before');
      ensure(after === null || int32(after), 'Cell after');
      object.cells = object.cells.filter(x => x.index !== change.index);
      if (after !== object.defaultValue) object.cells.push({ index: change.index, value: after });
      object.cells.sort((a, b) => a.index - b.index);
    } else if (['control', 'allocator', 'counters'].includes(change.op)) {
      const before = reverse ? change.after : change.before, after = reverse ? change.before : change.after;
      equal(state[change.op], before, `${change.op} before`);
      state[change.op] = clone(after);
    } else if (change.op === 'output') {
      ensure(change.afterBytes - change.beforeBytes === utf8(change.append), 'Output byte delta');
      if (reverse) {
        ensure(utf8(state.output) === change.afterBytes && state.output.endsWith(change.append), 'Output reverse suffix');
        if (change.append.length) state.output = state.output.slice(0, -change.append.length);
        ensure(utf8(state.output) === change.beforeBytes, 'Output reverse length');
      } else {
        ensure(utf8(state.output) === change.beforeBytes, 'Output before length');
        state.output += change.append;
        ensure(utf8(state.output) === change.afterBytes, 'Output after length');
      }
    } else fail('E_TRACE_INVALID', 'Unknown change');
  }

  validateState(trace.initialState);
  ensure(trace.steps.length <= 20000 && trace.initialState.frames.length === 0 && trace.initialState.objects.length === 0 && trace.initialState.scopes.length === 0 && trace.initialState.output === '' && trace.initialState.control.phase === 'ready', 'Initial state');
  const states = [clone(trace.initialState)];
  let state = clone(trace.initialState), peak = 0;
  for (const step of trace.steps) {
    ensure(step.seq === states.length && stepsAllowed.has(step.kind), 'Sequence/kind');
    locate(step.location);
    let scalarWrites = 0, arrayWrites = 0;
    for (const observation of step.observations) {
      ensure(nodes.has(observation.nodeId), 'Observation source');
      if (observation.kind === 'read') {
        const object = state.objects.find(x => x.id === observation.objectId);
        ensure(object && observation.index >= 0 && observation.index < object.length, 'Observation object/index');
        equal(object.cells.find(x => x.index === observation.index)?.value ?? object.defaultValue, observation.value, 'Observation value');
        ensure(int32(observation.value), 'Observed uninitialized cell');
      } else ensure(['evaluate', 'decision', 'short-circuit', 'swap'].includes(observation.kind), 'Unknown observation');
    }
    for (const change of step.changes) {
      if (change.op === 'cell') {
        const object = state.objects.find(x => x.id === change.objectId);
        if (object?.kind === 'int') scalarWrites++; else arrayWrites++;
      }
      if (step.kind === 'value.initialize' && change.op === 'record' && change.table === 'objects' && change.after?.kind === 'int-array') arrayWrites += change.after.length;
      apply(state, change);
    }
    const previousCounters = states.at(-1).counters;
    equal(state.counters.scalarWrites - previousCounters.scalarWrites, scalarWrites, 'Scalar write count');
    equal(state.counters.arrayWrites - previousCounters.arrayWrites, arrayWrites, 'Array write count');
    const comparisons = step.observations.filter(x => x.kind === 'evaluate' && ['<', '<=', '>', '>=', '==', '!='].includes(x.operator)).length;
    equal(state.counters.comparisons - previousCounters.comparisons, comparisons, 'Comparison count');
    equal(state.counters.swaps - previousCounters.swaps, step.observations.filter(x => x.kind === 'swap').length, 'Swap count');
    validateState(state);
    peak = Math.max(peak, state.allocator.liveBytes);
    states.push(clone(state));
  }
  ensure(result.terminal.cursor === trace.steps.length, 'Terminal cursor');
  if (result.terminal.status === 'completed') {
    ensure(trace.completeness === 'complete' && trace.steps.at(-1)?.kind === 'program.return' && state.control.phase === 'returned', 'Completed trace');
    equal(result.terminal.exitCode, state.control.returnValue, 'Actual return value');
  } else ensure(trace.completeness === 'prefix' && result.terminal.exitCode === null, 'Failure prefix');
  const expectedCheckpointCursors = Array.from({ length: Math.floor(trace.steps.length / 128) + 1 }, (_, i) => i * 128);
  equal(trace.checkpoints.map(x => x.cursor), expectedCheckpointCursors, 'Checkpoint cadence');
  for (const checkpoint of trace.checkpoints) equal(checkpoint.state, states[checkpoint.cursor], 'Checkpoint state');
  for (let cursor = trace.steps.length; cursor > 0; cursor--) {
    for (const change of [...trace.steps[cursor - 1].changes].reverse()) apply(state, change, true);
    validateState(state);
    equal(state, states[cursor - 1], 'Full backward state');
  }
  equal(state, trace.initialState, 'N forward then N backward');
  for (let cursor = 0; cursor < states.length; cursor++) {
    const checkpoint = trace.checkpoints[Math.floor(cursor / 128)];
    const projected = clone(checkpoint.state);
    for (let at = checkpoint.cursor; at < cursor; at++) for (const change of trace.steps[at].changes) apply(projected, change);
    equal(projected, states[cursor], 'Checkpoint seek');
  }
  if (result.stats) ensure(result.stats.peakVirtualBytes === peak, 'Actual virtual peak');

  if (request.mode === 'exercise-test') {
    const exercise = content.exercises.find(x => x.id === request.subjectRef.id && x.version === request.subjectRef.version);
    ensure(exercise, 'Exercise reference', 'E_PROTOCOL_INVALID');
    const test = exercise.tests.find(x => x.caseKey === request.identity.testCaseKey);
    ensure(test && isDeepStrictEqual(test.input, request.input.values), 'Test instance', 'E_PROTOCOL_INVALID');
    const program = content.programs.find(x => x.id === exercise.programRef.id);
    const profile = content.judgeProfiles.find(x => x.id === exercise.judgeRef.id);
    equal(request.programRef, exercise.programRef, 'Expected program reference', 'E_PROTOCOL_INVALID');
    equal(request.input.specRef, program.inputRef, 'Expected input reference', 'E_PROTOCOL_INVALID');
    equal(request.judge.profileRef, exercise.judgeRef, 'Expected judge reference', 'E_PROTOCOL_INVALID');
    equal(request.judge.rule, profile.rule, 'Expected judge rule', 'E_PROTOCOL_INVALID');
    equal(request.judge.expectedStdout, test.expectedStdout, 'Frozen stdout expectation', 'E_PROTOCOL_INVALID');
    equal(request.judge.expectedExitCode, test.expectedExitCode, 'Frozen exit expectation', 'E_PROTOCOL_INVALID');
    equal(request.judge.expectedArray, test.expectedArray, 'Frozen array expectation', 'E_PROTOCOL_INVALID');
    const judge = result.judgeResult;
    ensure(judge && judge.caseKey === test.caseKey && isDeepStrictEqual(judge.profileRef, request.judge.profileRef), 'Judge identity', 'E_PROTOCOL_INVALID');
    const required = ['input-bindings', 'stdout-exact', 'exit-zero', 'teaching-target'];
    if (request.judge.rule === 'while-for-accumulations') required.push('while-accumulation', 'for-accumulation');
    equal(judge.checks.map(x => x.key).sort(), [...required].sort(), 'Missing/duplicate judge check', 'E_PROTOCOL_INVALID');
    if (judge.status === 'met') ensure(result.terminal.status === 'completed' && result.terminal.exitCode === 0 && judge.checks.every(x => x.status === 'met') && states.at(-1).output === request.judge.expectedStdout, 'Unfounded met judge', 'E_PROTOCOL_INVALID');
    if (judge.status === 'met' && request.judge.rule === 'single-index-increment') {
      ensure(judge.observations.length === 1 && judge.observations[0].bindingKey === 'param.values' && judge.observations[0].values.length === request.input.values.values.length, 'Required unique array evidence missing', 'E_PROTOCOL_INVALID');
    }
    for (const check of judge.checks) {
      check.nodeIds.forEach(id => ensure(nodes.has(id), 'Judge node'));
      check.stepSeqs.forEach(seq => ensure(seq > 0 && seq < states.length, 'Judge step'));
    }
    for (const observation of judge.observations) {
      ensure(observation.kind === 'array-before-destroy' && observation.beforeCursor >= 0 && observation.beforeCursor + 1 < states.length, 'Judge observation cursor');
      locate(observation.location);
      equal(observation.location, trace.steps[observation.beforeCursor].location, 'Observation destroy location');
      const object = states[observation.beforeCursor].objects.find(x => x.id === observation.objectId);
      const binding = result.resolvedBindings.find(x => x.bindingKey === observation.bindingKey);
      ensure(object && binding && object.declarationNodeId === binding.declarationNodeId && object.declarationNodeId === observation.declarationNodeId, 'Observed bound object');
      equal(observation.values, observation.values.map((_, i) => object.cells.find(x => x.index === i)?.value ?? object.defaultValue), 'Before-destroy values');
      ensure(trace.steps[observation.beforeCursor].changes.some(x => x.op === 'record' && x.table === 'objects' && x.id === object.id && x.after === null), 'Observed object not destroyed');
      if (request.judge.expectedArray) equal(observation.values, request.judge.expectedArray, 'Expected array observation');
    }
  }
  return { steps: trace.steps.length, states, requestsBytes: utf8(canonical(request)), resultBytes: utf8(canonical(result)) };
}

let reversibleStates = 0, allSteps = 0;
const sizes = [];
for (const fixture of fixtures) {
  const checked = verifyPair(fixture), expected = fixture.expected;
  allSteps += checked.steps; reversibleStates += checked.states.length;
  sizes.push({ id: fixture.id, requestBytes: checked.requestsBytes, resultBytes: checked.resultBytes });
  if (expected.traceAvailable === false) ensure(fixture.result.trace === null, 'Expected no trace');
  else {
    equal(checked.steps, expected.stepCount, 'Fixture step count');
    if (Object.hasOwn(expected, 'output')) equal(checked.states.at(-1).output, expected.output, 'Fixture output');
    if (expected.outputBytes !== undefined) equal(utf8(checked.states.at(-1).output), expected.outputBytes, 'Fixture output bytes');
    equal(fixture.result.terminal.exitCode, expected.exitCode, 'Fixture exit');
    for (const assertion of expected.cursorAssertions) {
      const state = checked.states[assertion.cursor];
      ensure(state, 'Missing expected cursor');
      if (assertion.objectId) {
        const object = state.objects.find(x => x.id === assertion.objectId);
        ensure(object, 'Expected object');
        if (assertion.values) equal(assertion.values, assertion.values.map((_, i) => object.cells.find(c => c.index === i)?.value ?? object.defaultValue), 'Expected cells');
        if (assertion.length) equal(object.length, assertion.length, 'Expected capacity');
        if (Object.hasOwn(assertion, 'defaultValue')) equal(object.defaultValue, assertion.defaultValue, 'Expected initialization');
      }
      if (assertion.absentObjectId) ensure(!state.objects.some(x => x.id === assertion.absentObjectId), 'Destroyed object remained');
      for (const [key, table] of [['objectCount', 'objects'], ['frameCount', 'frames'], ['scopeCount', 'scopes']]) if (assertion[key] !== undefined) equal(state[table].length, assertion[key], 'Expected state table size');
      if (assertion.liveBytes !== undefined) equal(state.allocator.liveBytes, assertion.liveBytes, 'Expected live bytes');
      if (assertion.nextNodeId) equal(state.control.nextNodeId, assertion.nextNodeId, 'Expected next node');
      if (assertion.output !== undefined) equal(state.output, assertion.output, 'Expected cursor output');
      if (assertion.outputBytes !== undefined) equal(utf8(state.output), assertion.outputBytes, 'Expected cursor output bytes');
    }
  }
}

for (const scenario of scenarios.invalidResults) {
  const fixture = clone(fixtures.find(x => x.id === scenario.fixtureId));
  ensure(fixture, 'Missing negative base');
  for (const operation of scenario.operations) {
    const keys = operation.path.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent = fixture;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    const key = keys.at(-1);
    if (operation.op === 'set') parent[key] = clone(operation.value);
    else if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
  }
  let actual = 'VALID';
  try { verifyPair(fixture); } catch (error) { actual = error.code; }
  equal(actual, scenario.expectedCode, `Negative scenario ${scenario.id}`);
}

for (const vector of scenarios.canonicalVectors) {
  equal(canonical(vector.value), vector.expected, 'Canonical golden vector');
  equal(strictJson(vector.expected, true), vector.value, 'Canonical roundtrip');
}
for (const vector of scenarios.rawJsonVectors) {
  let code = 'VALID';
  try { strictJson(vector.json, true); } catch (error) { code = error.code; }
  equal(code, vector.expectedCode, vector.id);
}
for (const vector of scenarios.coordinateVectors) {
  const points = bytePoints(vector.source);
  for (const p of vector.points) equal(points.get(p.byteOffset), { line: p.line, column: p.column, utf16Offset: p.utf16Offset }, 'Coordinate vector');
  vector.invalidByteOffsets.forEach(at => ensure(!points.has(at), 'Invalid Unicode/CRLF midpoint accepted'));
}

for (const scenario of scenarios.lifecycleCases) {
  const state = { ...scenario.initial, resultsAccepted: 0 };
  for (const event of scenario.events) {
    if (event.kind === 'edit') { state.contextRevision++; state.status = 'invalidated'; continue; }
    if (['running', 'validating'].includes(state.status) && event.at >= state.deadline) state.status = 'expired';
    if (event.kind === 'cancel' && ['running', 'validating'].includes(state.status)) state.status = 'cancelled';
    if (event.kind === 'receive' && state.status === 'running' && event.sourceRunId === state.runId && event.runId === state.runId && event.revision === state.contextRevision) state.status = event.producer === 'fixture' ? 'failed' : 'validating';
    if (event.kind === 'validate' && state.status === 'validating') { state.status = 'accepted'; state.resultsAccepted++; }
  }
  equal({ status: state.status, resultsAccepted: state.resultsAccepted }, scenario.expected, scenario.id);
}
for (const vector of scenarios.budgetVectors) {
  ensure(vector.at === vector.limit && vector.over === vector.limit + 1, 'Discrete budget vector');
  ensure(vector.at <= vector.limit && !(vector.over <= vector.limit), 'Budget equality policy');
}
// These are symbolic metadata expressions, never user C expressions.
function contributions(expression) {
  if (expression.kind === 'symbol') return { constant: 0, terms: { [expression.name]: 1 } };
  if (expression.kind === 'constant') return { constant: expression.value, terms: {} };
  const left = contributions(expression.left), right = contributions(expression.right);
  if (expression.kind === 'add' || expression.kind === 'subtract') {
    const sign = expression.kind === 'add' ? 1 : -1;
    const terms = { ...left.terms };
    for (const [key, value] of Object.entries(right.terms)) terms[key] = (terms[key] || 0) + sign * value;
    for (const key of Object.keys(terms)) if (terms[key] === 0) delete terms[key];
    return { constant: left.constant + sign * right.constant, terms };
  }
  ensure(expression.kind === 'multiply', 'Unknown symbolic fixture operator');
  const fixed = Object.keys(left.terms).length === 0 ? left : right;
  const moving = fixed === left ? right : left;
  ensure(Object.keys(fixed.terms).length === 0 && [0, 1].includes(fixed.constant), 'Unregistered contribution pattern');
  return { constant: moving.constant * fixed.constant, terms: fixed.constant === 0 ? {} : moving.terms };
}
for (const vector of scenarios.contributionVectors) equal(contributions(vector.expression).terms, vector.expected, 'Signed contribution/cancellation vector');

console.log(JSON.stringify({
  fixturePairs: fixtures.length, nonNullTraces: fixtures.filter(x => x.result.trace).length,
  authoredSteps: allSteps, reversibleCursorStates: reversibleStates,
  invalidResults: scenarios.invalidResults.length, lifecycleVectors: scenarios.lifecycleCases.length,
  canonicalVectors: scenarios.canonicalVectors.length, malformedWireVectors: scenarios.rawJsonVectors.length,
  coordinateVectors: scenarios.coordinateVectors.length, budgetPairs: scenarios.budgetVectors.length,
  contributionVectors: scenarios.contributionVectors.length, sizes,
  limitation: 'Authored DSL and contract assertions only; no C/Rust/Worker/browser execution.'
}, null, 2));
