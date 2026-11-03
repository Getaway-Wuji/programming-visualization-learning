/** Closed schema plus C6 semantic validation. No source parsing or algorithm evaluation. */
import * as schema from '../generated/c6/schema.mjs';
import { judgeDomains } from '../generated/c6/judge-domains';
import { generateBlockSource } from '../blocks/generator';
import type { BlockProgram } from '../blocks/model';
import { precheckJson } from './execution-json';
import { applyC6Step, c6Assert, c6Equal, C6TypeTable } from './c6-player';
import type {
  C6EditRequest,
  C6EditResult,
  C6JudgeResult,
  C6Node,
  C6Object,
  C6Request,
  C6Response,
  C6Result,
  C6State,
  C6Value,
} from './c6-types';
export * from './c6-types';
export { c6Assert };
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });
const size = (s: string) => encoder.encode(s).length;
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const opaque = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v);
export function canonicalC6Json(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalC6Json).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalC6Json(object[k])}`)
    .join(',')}}`;
}
export async function c6SourceHash(source: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function editRequest(request: C6EditRequest) {
  c6Assert(schema.editRequest(request));
  c6Assert(
    exact(request, [
      'editVersion',
      'documentId',
      'packageRef',
      'engine',
      'sourceRevision',
      'sourceSha256',
      'source',
    ]) &&
      request.editVersion === '2.0.0' &&
      opaque(request.documentId) &&
      opaque(request.sourceRevision) &&
      c6Equal(request.packageRef, { id: 'content.c.primer6', version: '1.0.0' }) &&
      c6Equal(request.engine, { id: 'engine.rust.c6', version: '0.1.0' }),
  );
}
export function encodeC6Request(request: C6Request): Uint8Array<ArrayBuffer> {
  if ('editVersion' in request) editRequest(request);
  else c6Assert('judgeVersion' in request ? schema.judgeRequest(request) : schema.request(request));
  c6Assert(
    typeof request.source === 'string' &&
      size(request.source) <= 32768 &&
      decoder.decode(encoder.encode(request.source)) === request.source &&
      /^[a-f0-9]{64}$/.test(request.sourceSha256),
  );
  const bytes = encoder.encode(canonicalC6Json(request));
  c6Assert(bytes.length <= 65536);
  return bytes;
}
function sourceNodes(nodes: C6Node[], source: string) {
  const bytes = encoder.encode(source),
    boundaries = new Set<number>([0]);
  let offset = 0;
  for (const character of source) {
    offset += size(character);
    boundaries.add(offset);
  }
  const map = new Map<string, C6Node>();
  for (const [i, n] of nodes.entries()) {
    c6Assert(
      n.nodeId === `n${i + 1}` &&
        !map.has(n.nodeId) &&
        n.byteRange.start >= 0 &&
        n.byteRange.end >= n.byteRange.start &&
        n.byteRange.end <= bytes.length &&
        boundaries.has(n.byteRange.start) &&
        boundaries.has(n.byteRange.end),
    );
    map.set(n.nodeId, n);
  }
  return { map, boundaries };
}
function pointers(v: C6Value, types: C6TypeTable, objects: C6Object[]) {
  if (v && typeof v === 'object' && 'pointeeType' in v) types.pointer(v, objects);
}
function validateState(
  state: C6State,
  types: C6TypeTable,
  nodes: Map<string, C6Node>,
  inputLength: number,
  cache: WeakSet<object>,
) {
  c6Assert(
    state.frames.length <= 32 &&
      state.objects.length <= 4096 &&
      state.allocator.nextObject === state.objects.length + 1 &&
      state.allocator.nextAddress >= 4096 &&
      state.allocator.liveBytes <= 1048576 &&
      size(state.output) <= 16384 &&
      state.control.inputCursor <= inputLength,
  );
  const frames = new Map(state.frames.map((f) => [f.id, f])),
    scopes = new Map(state.scopes.map((s) => [s.id, s])),
    objects = new Map(state.objects.map((o) => [o.id, o]));
  c6Assert(
    frames.size === state.frames.length &&
      scopes.size === state.scopes.length &&
      objects.size === state.objects.length,
  );
  for (const [i, f] of state.frames.entries()) {
    c6Assert(
      nodes.has(f.functionNodeId) &&
        (f.callNodeId === null || nodes.has(f.callNodeId)) &&
        f.parentFrameId === (i === 0 ? null : state.frames[i - 1].id) &&
        new Set(f.scopeIds).size === f.scopeIds.length &&
        f.scopeIds.every((id) => scopes.get(id)?.frameId === f.id),
    );
  }
  let live = 0,
    previousEnd = 4096;
  for (const [i, o] of state.objects.entries()) {
    const type = types.get(o.typeName);
    c6Assert(
      o.id === `o${i + 1}` &&
        nodes.has(o.declarationNodeId) &&
        o.byteLength === type.byteSize &&
        o.length === (type.kind === 'array' ? type.elementCount : 1) &&
        o.baseAddress >= previousEnd &&
        o.baseAddress % type.alignment === 0,
    );
    previousEnd = o.baseAddress + o.byteLength;
    if (o.alive) live += o.byteLength;
    if (o.storage === 'automatic') {
      c6Assert(o.frameId !== null && o.scopeId !== null);
      if (o.alive)
        c6Assert(
          frames.has(o.frameId) &&
            scopes.get(o.scopeId)?.frameId === o.frameId &&
            scopes.get(o.scopeId)?.objectIds.includes(o.id),
        );
    } else c6Assert(o.frameId === null && o.scopeId === null && o.alive);
    if (o.storage === 'literal')
      c6Assert(
        !o.writable && type.kind === 'array' && types.get(type.elementType!).kind === 'char',
      );
    if (!cache.has(o)) {
      let offset = -1;
      for (const c of o.cells) {
        c6Assert(c.byteOffset > offset);
        offset = c.byteOffset;
        types.value(c.value, types.slot(type, c.byteOffset));
        pointers(c.value, types, state.objects);
        c6Assert(!c6Equal(c.value, types.default(o, c.byteOffset)));
      }
      cache.add(o);
    }
  }
  c6Assert(live === state.allocator.liveBytes && previousEnd === state.allocator.nextAddress);
  for (const s of state.scopes) {
    c6Assert(
      nodes.has(s.nodeId) &&
        (s.frameId === null || frames.get(s.frameId)?.scopeIds.includes(s.id)) &&
        new Set(s.objectIds).size === s.objectIds.length &&
        s.objectIds.every((id) => objects.get(id)?.alive),
    );
    const names = new Set<string>();
    for (const id of s.objectIds) {
      const o = objects.get(id)!;
      c6Assert(!names.has(o.name));
      names.add(o.name);
      if (o.storage === 'automatic') c6Assert(o.scopeId === s.id && o.frameId === s.frameId);
    }
    for (const alias of s.aliases) {
      c6Assert(objects.get(alias.objectId)?.alive && !names.has(alias.name));
      names.add(alias.name);
    }
  }
  c6Assert(
    state.control.activeFrameId === (state.frames.at(-1)?.id ?? null) &&
      (state.control.nextNodeId === null || nodes.has(state.control.nextNodeId)),
  );
  pointers(state.control.returnValue, types, state.objects);
}
function yieldTask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
interface RunTotals {
  steps: number;
  objects: number;
  outputBytes: number;
  fuel: number;
  stdout: string;
}
async function validateRun(
  result: C6Result,
  request: C6Request,
  buildId: string,
  inputLength: number,
  guard: () => void,
): Promise<RunTotals> {
  c6Assert(
    schema.result(result) &&
      result.engine.buildId === buildId &&
      result.identity.sourceSha256 === request.sourceSha256 &&
      result.identity.sourceRevision === request.sourceRevision &&
      'runId' in request &&
      result.identity.runId === request.runId,
  );
  const { map: nodes, boundaries } = sourceNodes(result.nodeMap, request.source),
    types = new C6TypeTable(result.types);
  if (result.terminal.byteRange)
    c6Assert(
      boundaries.has(result.terminal.byteRange.start) &&
        boundaries.has(result.terminal.byteRange.end) &&
        result.terminal.byteRange.start <= result.terminal.byteRange.end,
    );
  if (!result.trace) {
    c6Assert(
      result.terminal.status !== 'completed' &&
        result.terminal.code !== null &&
        result.terminal.cursor === 0 &&
        result.terminal.returnValue === null &&
        result.nodeMap.length === 0 &&
        result.types.length === 0,
    );
    return { steps: 0, objects: 0, outputBytes: 0, fuel: result.stats.fuelUsed, stdout: '' };
  }
  const trace = result.trace,
    root = result.nodeMap.find((n) => n.kind === 'translation-unit');
  c6Assert(root);
  const state = structuredClone(trace.initialState),
    initial = structuredClone(state);
  c6Assert(
    c6Equal(initial, {
      frames: [],
      scopes: [],
      objects: [],
      control: { activeFrameId: null, nextNodeId: root.nodeId, returnValue: null, inputCursor: 0 },
      allocator: { nextAddress: 4096, liveBytes: 0, nextObject: 1, nextScope: 1, nextFrame: 1 },
      output: '',
      counters: { comparisons: 0, scalarWrites: 0, arrayWrites: 0, swaps: 0 },
    }),
  );
  c6Assert(
    trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1 &&
      trace.checkpoints.every((p, i) => p.cursor === i * 128),
  );
  c6Assert(c6Equal(trace.checkpoints[0].state, initial));
  const cache = new WeakSet<object>();
  const writtenObjects = new Set<string>();
  let lastYield = performance.now();
  for (const [i, step] of trace.steps.entries()) {
    c6Assert(step.seq === i + 1 && nodes.has(step.nodeId));
    for (const change of step.changes) {
      if (change.op === 'record') {
        if (change.table === 'objects') {
          c6Assert(change.after !== null);
          const after = change.after as C6Object;
          if (change.before === null)
            c6Assert(
              after.alive &&
                change.index === state.objects.length &&
                after.id === `o${state.objects.length + 1}`,
            );
          else {
            const before = change.before as C6Object;
            c6Assert(
              step.kind === 'scope.exit' &&
                before.storage === 'automatic' &&
                before.alive &&
                !after.alive,
            );
          }
        }
        if (change.before !== null && change.after !== null) {
          const before = change.before as unknown as Record<string, unknown>,
            after = change.after as unknown as Record<string, unknown>;
          const mutable =
            change.table === 'objects'
              ? ['alive']
              : change.table === 'frames'
                ? ['scopeIds']
                : ['objectIds', 'aliases'];
          c6Assert(
            Object.keys(before).every(
              (key) => mutable.includes(key) || c6Equal(before[key], after[key]),
            ),
          );
        }
      } else if (change.op === 'cell' && step.kind === 'value.initialize') {
        const object = state.objects.find((o) => o.id === change.objectId);
        c6Assert(
          object && object.declarationNodeId === step.nodeId && !writtenObjects.has(object.id),
        );
      } else if (change.op === 'counters') {
        for (const key of ['comparisons', 'scalarWrites', 'arrayWrites', 'swaps'] as const)
          c6Assert(change.after[key] >= change.before[key]);
      } else if (change.op === 'allocator') {
        for (const key of ['nextAddress', 'nextObject', 'nextScope', 'nextFrame'] as const)
          c6Assert(change.after[key] >= change.before[key]);
      }
    }
    applyC6Step(state, step, types);
    for (const change of step.changes)
      if (change.op === 'cell') writtenObjects.add(change.objectId);
    validateState(state, types, nodes, inputLength, cache);
    if ((i + 1) % 128 === 0) c6Assert(c6Equal(state, trace.checkpoints[(i + 1) / 128].state));
    if (performance.now() - lastYield > 8) {
      guard();
      await yieldTask();
      guard();
      lastYield = performance.now();
    }
  }
  c6Assert(
    result.terminal.cursor === trace.steps.length &&
      (result.terminal.status === 'completed'
        ? trace.completeness === 'complete'
        : trace.completeness === 'prefix'),
  );
  if (result.terminal.status === 'completed')
    c6Assert(
      state.frames.length === 0 &&
        state.scopes.length === 1 &&
        state.control.nextNodeId === null &&
        c6Equal(result.terminal.returnValue, state.control.returnValue),
    );
  const totals = {
    steps: trace.steps.length,
    objects: state.objects.length,
    outputBytes: size(state.output),
    fuel: result.stats.fuelUsed,
    stdout: state.output,
  };
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    applyC6Step(state, trace.steps[i], types, true);
    if (performance.now() - lastYield > 8) {
      guard();
      await yieldTask();
      guard();
      lastYield = performance.now();
    }
  }
  c6Assert(c6Equal(state, initial));
  guard();
  return totals;
}
/** Rehydrate only the finite block graph. This reads Rust's mapping, never C source. */
export function c6BlockProgram(result: C6EditResult): BlockProgram | null {
  if (result.program === null) return null;
  c6Assert(
    exact(result.program, ['rootId', 'nodes']) &&
      opaque(result.program.rootId) &&
      Array.isArray(result.program.nodes) &&
      result.program.nodes.length <= 32768,
  );
  const nodes = new Map<string, Record<string, unknown>>();
  for (const node of result.program.nodes) {
    c6Assert(
      node !== null &&
        typeof node === 'object' &&
        !Array.isArray(node) &&
        opaque(node.id) &&
        typeof node.kind === 'string' &&
        !nodes.has(node.id),
    );
    nodes.set(node.id, node);
  }
  const childFields: Record<string, string[]> = {
    main: [],
    integer: [],
    variable: [],
    unary: ['operand'],
    arithmetic: ['left', 'right'],
    compare: ['left', 'right'],
    logic: ['left', 'right'],
    array_read: ['index'],
    declare: ['initial'],
    assign: ['value'],
    if: ['condition'],
    while: ['condition'],
    for: ['init', 'condition', 'update'],
    break: [],
    continue: [],
    array_declare: [],
    array_write: ['index', 'value'],
    print: [],
    return: ['value'],
    scope: [],
  };
  const listFields: Record<string, string[]> = {
    main: ['body'],
    scope: ['body'],
    if: ['then', 'else'],
    while: ['body'],
    for: ['body'],
    print: ['args'],
  };
  const visited = new Set<string>();
  const expand = (id: unknown, depth: number): Record<string, unknown> => {
    c6Assert(typeof id === 'string' && depth <= 64 && !visited.has(id));
    const node = nodes.get(id);
    c6Assert(node && Object.hasOwn(childFields, node.kind as string));
    visited.add(id);
    const value = { ...node };
    for (const key of childFields[node.kind as string])
      if (value[key] !== null) value[key] = expand(value[key], depth + 1);
    for (const key of listFields[node.kind as string] ?? []) {
      if (value[key] === null) continue;
      c6Assert(Array.isArray(value[key]));
      value[key] = (value[key] as unknown[]).map((id) => expand(id, depth + 1));
    }
    return value;
  };
  const tree = expand(result.program.rootId, 0) as unknown as BlockProgram;
  c6Assert(visited.size === nodes.size);
  try {
    generateBlockSource(tree, { text: result.source, bindingMap: [], blockMap: [] }, []);
  } catch {
    throw new Error('E_PROTOCOL_INVALID');
  }
  return tree;
}
function validateEdit(result: C6EditResult, request: C6EditRequest, buildId: string) {
  c6Assert(schema.editResult(result));
  c6Assert(
    exact(result, [
      'editVersion',
      'documentId',
      'packageRef',
      'engine',
      'sourceRevision',
      'sourceSha256',
      'source',
      'status',
      'nodeMap',
      'program',
      'blockMap',
      'diagnostics',
      'profileRef',
    ]),
  );
  for (const key of [
    'editVersion',
    'documentId',
    'packageRef',
    'sourceRevision',
    'sourceSha256',
    'source',
  ] as const)
    c6Assert(c6Equal(result[key], request[key]));
  c6Assert(
    c6Equal(result.engine, { ...request.engine, buildId }) &&
      c6Equal(result.profileRef, { id: 'block-set.c6.common-int', version: '1.0.0' }) &&
      ['mapped', 'code-only', 'invalid', 'unsupported'].includes(result.status) &&
      Array.isArray(result.nodeMap) &&
      Array.isArray(result.blockMap) &&
      Array.isArray(result.diagnostics),
  );
  const { map, boundaries } = sourceNodes(result.nodeMap, request.source);
  for (const d of result.diagnostics)
    c6Assert(
      exact(d, ['code', 'byteRange']) &&
        /^E_[A-Z_]+$/.test(d.code) &&
        boundaries.has(d.byteRange.start) &&
        boundaries.has(d.byteRange.end) &&
        d.byteRange.start <= d.byteRange.end,
    );
  if (result.status === 'mapped') {
    c6Assert(result.program && result.diagnostics.length === 0);
    const ids = new Set<string>();
    c6Assert(c6BlockProgram(result));
    for (const b of result.blockMap) {
      c6Assert(
        exact(b, ['blockId', 'nodeId', 'byteRange']) &&
          opaque(b.blockId) &&
          !ids.has(b.blockId) &&
          c6Equal(map.get(b.nodeId)?.byteRange, b.byteRange),
      );
      ids.add(b.blockId);
    }
    for (const node of result.program.nodes)
      c6Assert(typeof node.id === 'string' && ids.delete(node.id));
    c6Assert(ids.size === 0);
  } else
    c6Assert(
      result.program === null &&
        result.blockMap.length === 0 &&
        (result.status === 'code-only'
          ? result.diagnostics.length === 0
          : result.diagnostics.length > 0),
    );
}
export async function decodeC6Response(
  buffer: ArrayBuffer,
  request: C6Request,
  buildId: string,
  guard: () => void = () => {},
): Promise<C6Response> {
  guard();
  c6Assert(buffer.byteLength > 0 && buffer.byteLength <= 16777216);
  const text = decoder.decode(buffer);
  for (const _ of precheckJson(text)) {
    void _;
    guard();
    await yieldTask();
    guard();
  }
  const value: unknown = JSON.parse(text);
  guard();
  c6Assert((await c6SourceHash(request.source)) === request.sourceSha256);
  guard();
  if ('editVersion' in request) {
    validateEdit(value as C6EditResult, request, buildId);
    guard();
    return value as C6EditResult;
  }
  if ('judgeVersion' in request) {
    c6Assert(schema.judgeResult(value));
    const result = value as C6JudgeResult;
    c6Assert(
      c6Equal(result.profileRef, request.profileRef) &&
        c6Equal(result.packageRef, request.packageRef) &&
        result.sourceSha256 === request.sourceSha256 &&
        result.aggregate.resultBytes === buffer.byteLength,
    );
    const domain = judgeDomains.find((p) => p.id === request.profileRef.id);
    c6Assert(domain);
    const totals = { steps: 0, objects: 0, outputBytes: 0, fuel: 0 };
    for (const [i, c] of result.cases.entries()) {
      c6Assert(c.caseKey === `case-${i + 1}`);
      const expected = domain.cases[i];
      const t = await validateRun(c.packet, request, buildId, expected.inputBytes, guard);
      for (const key of ['steps', 'objects', 'outputBytes', 'fuel'] as const) totals[key] += t[key];
      c6Assert(
        c.stdoutMatches === ((await c6SourceHash(t.stdout)) === expected.outputSha256) &&
          c.returnMatches ===
            (c.packet.terminal.status === 'completed' && c.packet.terminal.returnValue === 0),
      );
      guard();
      for (const proof of c.observations)
        c6Assert(
          c.packet.nodeMap.some((n) => n.nodeId === proof.nodeId) &&
            proof.seq <= c.packet.terminal.cursor &&
            c.packet.trace?.steps[proof.seq - 1].nodeId === proof.nodeId &&
            proof.objectIds.every((id) => Number(id.slice(1)) <= t.objects) &&
            [...domain.targets, 'input.source', expected.guard].includes(proof.tag),
        );
      if (c.observationMatches)
        c6Assert(
          expected.guard
            ? c.observations.some((p) => p.tag === expected.guard)
            : domain.targets.every((tag) => c.observations.some((p) => p.tag === tag)),
        );
    }
    c6Assert(
      result.aggregate.steps === totals.steps &&
        result.aggregate.objects === totals.objects &&
        result.aggregate.outputBytes === totals.outputBytes &&
        result.aggregate.fuel >= totals.fuel &&
        result.aggregate.fuel <= 1000000,
    );
    c6Assert(
      result.status !== 'passed' ||
        (result.cases.length === 4 &&
          result.cases.every(
            (c) =>
              c.stdoutMatches &&
              c.returnMatches &&
              c.observationMatches &&
              c.packet.terminal.status === 'completed' &&
              c.packet.terminal.returnValue === 0,
          )),
    );
    guard();
    return result;
  }
  await validateRun(value as C6Result, request, buildId, size(request.input.text), guard);
  return value as C6Result;
}
