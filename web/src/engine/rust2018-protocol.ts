import { rust2018Protocol } from '../../../shared/contracts/rust2018-execution.mjs';
import profilesText from '../../../shared/contracts/rust2018-profiles-1.0.0.json?raw';
import { validateRequest, validateResponse } from '../generated/rust2018/protocol.mjs';
import { canonicalC6Json } from './c6-protocol';
import { precheckJson } from './execution-json';
import { yieldTask } from './protocol';
import { rustAssert, rustEqual, verifyRustTrace } from './rust2018-player';

export { rust2018Protocol };
export interface RustRange {
  start: number;
  end: number;
}
export interface RustDiagnostic {
  code: string;
  byteRange: RustRange;
}
export type RustStatus = 'completed' | 'error' | 'limited';
export type RustOperation =
  | { operation: 'execute'; input: string }
  | { operation: 'analyze' }
  | { operation: 'judge'; profile: string; reviewCase: number };
export type RustRequest = RustOperation & {
  version: '1.0.0';
  language: 'rust';
  edition: '2018';
  runId: string;
  sourceRevision: string;
  source: string;
};
export interface RustNode {
  id: number;
  kind: string;
  byteRange: RustRange;
}
export type RustType =
  | 'unit'
  | 'i32'
  | 'bool'
  | 'String'
  | `[i32;${number}]`
  | '&i32'
  | '&mut i32'
  | '&String'
  | '&mut String';
export type RustValue =
  | { kind: 'unit' }
  | { kind: 'i32'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string-object' | 'array-object'; objectId: number }
  | { kind: 'reference'; loanId: number };
export interface RustFrame {
  id: number;
  functionNode: number;
  callNode: number | null;
  scopeIds: number[];
}
export interface RustBinding {
  id: number;
  declarationNode: number;
  frameId: number;
  scopeId: number;
  name: string;
  type: RustType;
  mutable: boolean;
  status: 'live' | 'moved';
  value: RustValue;
}
export type RustObject =
  | { id: number; kind: 'string'; text: string; items: null; alive: boolean }
  | { id: number; kind: 'array'; text: null; items: number[]; alive: boolean };
export interface RustLoan {
  id: number;
  targetBindingId: number;
  mutable: boolean;
  parameterBindingId: number;
}
export interface RustTemporary {
  id: number;
  type: RustType;
  value: RustValue;
}
export interface RustControl {
  nodeId: number | null;
  inputCursor: number;
  returnValue: RustValue | null;
}
export interface RustAllocator {
  nextFrame: number;
  nextScope: number;
  nextBinding: number;
  nextObject: number;
  nextLoan: number;
  nextTemporary: number;
  liveBytes: number;
}
export interface RustState {
  frames: RustFrame[];
  bindings: RustBinding[];
  objects: RustObject[];
  loans: RustLoan[];
  temporaries: RustTemporary[];
  control: RustControl;
  allocator: RustAllocator;
  output: string;
}
export interface RustTableRecords {
  bindings: RustBinding;
  objects: RustObject;
  loans: RustLoan;
  temporaries: RustTemporary;
}
export type RustTable = keyof RustTableRecords;
export type RustSingleton = 'frames' | 'control' | 'allocator' | 'output';
export type RustChange =
  | {
      [K in RustTable]: {
        component: K;
        id: number;
        before: RustTableRecords[K] | null;
        after: RustTableRecords[K] | null;
      };
    }[RustTable]
  | {
      [K in RustSingleton]: { component: K; before: RustState[K]; after: RustState[K] };
    }[RustSingleton];
export interface RustStep {
  seq: number;
  nodeId: number;
  event: string;
  changes: RustChange[];
}
export interface RustTrace {
  initialState: RustState;
  steps: RustStep[];
  checkpoints: { cursor: number; state: RustState }[];
  completeness: 'complete' | 'prefix';
}
export interface RustReplay {
  terminal: { status: RustStatus; diagnostic: RustDiagnostic | null; cursor: number };
  trace: RustTrace;
}
export interface RustResponse {
  version: '1.0.0';
  language: 'rust';
  edition: '2018';
  operation: RustOperation['operation'];
  buildId: string;
  identity: { runId: string; sourceRevision: string };
  status: RustStatus;
  diagnostic: RustDiagnostic | null;
  nodeMap: RustNode[];
  analysis: {
    status: 'mapped' | 'code-only' | 'invalid' | 'unsupported';
    blockMap: number[];
  } | null;
  judgement: {
    passed: boolean;
    reviewCase: number;
    cases: {
      index: number;
      status: RustStatus;
      passed: boolean;
      diagnostic: RustDiagnostic | null;
    }[];
  } | null;
  replay: RustReplay | null;
  usage: { fuel: number; steps: number; objects: number; outputBytes: number; resultBytes: number };
}
export type Rust2018Request = RustRequest;
export type Rust2018Response = RustResponse;
export type Rust2018State = RustState;
export type Rust2018Replay = RustReplay;

interface Profile {
  id: string;
  cases: { input: string; expected: string; requiredFeatures: string[] }[];
}
const profiles = new Map(
  (JSON.parse(profilesText) as Profile[]).map((profile) => [profile.id, profile]),
);
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
export function rustJudgeInput(profile: string, reviewCase: number) {
  return profiles.get(profile)?.cases[reviewCase]?.input;
}
export function rustPositions(source: string) {
  const positions = new Map<number, { line: number; column: number; utf16Offset: number }>();
  let byte = 0,
    line = 1,
    column = 1,
    offset = 0;
  positions.set(0, { line, column, utf16Offset: offset });
  for (const scalar of source) {
    byte += bytes(scalar);
    offset += scalar.length;
    if (scalar === '\n') {
      line++;
      column = 1;
    } else column++;
    positions.set(byte, { line, column, utf16Offset: offset });
  }
  return positions;
}
export function encodeRustRequest(request: RustRequest): Uint8Array<ArrayBuffer> {
  if (
    request.source.length > rust2018Protocol.sourceBytes ||
    bytes(request.source) > rust2018Protocol.sourceBytes
  )
    throw new Error('E_SOURCE_LIMIT');
  if (new TextDecoder().decode(encoder.encode(request.source)) !== request.source)
    throw new Error('E_REQUEST_INVALID');
  if (request.operation === 'execute') {
    if (
      request.input.length > rust2018Protocol.inputBytes ||
      bytes(request.input) > rust2018Protocol.inputBytes
    )
      throw new Error('E_INPUT_LIMIT');
    if (new TextDecoder().decode(encoder.encode(request.input)) !== request.input)
      throw new Error('E_REQUEST_INVALID');
  }
  if (!validateRequest(request)) throw new Error('E_REQUEST_INVALID');
  if (request.operation === 'judge' && !profiles.has(request.profile))
    throw new Error('E_PROFILE_UNKNOWN');
  const buffer = encoder.encode(canonicalC6Json(request));
  if (buffer.byteLength > rust2018Protocol.requestBytes) throw new Error('E_REQUEST_INVALID');
  return buffer;
}
export function rustRequest(
  source: string,
  operation: RustOperation,
  revision: string = crypto.randomUUID(),
) {
  const request: RustRequest = {
    version: '1.0.0',
    language: 'rust',
    edition: '2018',
    runId: crypto.randomUUID(),
    sourceRevision: revision,
    source,
    ...operation,
  };
  return { request, bytes: encodeRustRequest(request) };
}

async function consume<T>(iterator: Generator<void, T>, guard: () => void): Promise<T> {
  let until = performance.now() + 6;
  for (;;) {
    const step = iterator.next();
    guard();
    if (step.done) return step.value;
    if (performance.now() >= until) {
      await yieldTask();
      guard();
      until = performance.now() + 6;
    }
  }
}
export async function decodeRustResponse(
  buffer: ArrayBuffer,
  request: RustRequest,
  buildId: string,
  guard: () => void,
): Promise<RustResponse> {
  try {
    guard();
    rustAssert(validateRequest(request));
    rustAssert(buffer.byteLength > 0 && buffer.byteLength <= rust2018Protocol.resultBytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    await consume(precheckJson(text), guard);
    const raw: unknown = JSON.parse(text);
    rustAssert(validateResponse(raw));
    const response = raw as RustResponse;
    rustAssert(
      response.buildId === buildId &&
        response.operation === request.operation &&
        response.version === request.version &&
        response.language === request.language &&
        response.edition === request.edition &&
        response.identity.runId === request.runId &&
        response.identity.sourceRevision === request.sourceRevision,
    );
    const positions = rustPositions(request.source);
    const range = (value: RustRange) =>
      rustAssert(
        value.start <= value.end && positions.has(value.start) && positions.has(value.end),
      );
    const diagnostic = (status: RustStatus, item: RustDiagnostic | null) => {
      rustAssert((status === 'completed') === (item === null));
      if (!item) return;
      range(item.byteRange);
      rustAssert(
        (status === 'limited') === (item.code.endsWith('_LIMIT') || item.code === 'E_DEADLINE'),
      );
    };
    diagnostic(response.status, response.diagnostic);
    const nodes = new Map<number, RustNode>();
    for (const [index, node] of response.nodeMap.entries()) {
      rustAssert(node.id === index + 1);
      range(node.byteRange);
      nodes.set(node.id, node);
    }
    if (request.operation === 'analyze') {
      rustAssert(
        response.analysis !== null && response.judgement === null && response.replay === null,
      );
      const analysis = response.analysis;
      if (response.status === 'completed') {
        rustAssert(analysis.status === 'mapped' || analysis.status === 'code-only');
        rustAssert(
          rustEqual(
            analysis.blockMap,
            analysis.status === 'mapped' ? response.nodeMap.map((node) => node.id) : [],
          ),
        );
      } else {
        rustAssert(
          analysis.status ===
            (response.diagnostic?.code === 'E_UNSUPPORTED' ? 'unsupported' : 'invalid') &&
            analysis.blockMap.length === 0,
        );
      }
    } else rustAssert(response.analysis === null);
    let replayInput: string | undefined;
    let selected: NonNullable<RustResponse['judgement']>['cases'][number] | undefined;
    if (request.operation === 'judge') {
      const profile = profiles.get(request.profile);
      rustAssert(profile);
      if (response.judgement) {
        const judgement = response.judgement;
        rustAssert(judgement.reviewCase === request.reviewCase && judgement.cases.length > 0);
        for (const [index, group] of judgement.cases.entries()) {
          rustAssert(group.index === index && (!group.passed || group.status === 'completed'));
          diagnostic(group.status, group.diagnostic);
          if (group.status === 'limited') rustAssert(index === judgement.cases.length - 1);
        }
        rustAssert(judgement.cases.length === 4 || judgement.cases.at(-1)?.status === 'limited');
        rustAssert(
          judgement.passed ===
            (judgement.cases.length === 4 && judgement.cases.every((group) => group.passed)),
        );
        const firstFault = judgement.cases.find((group) => group.status !== 'completed');
        rustAssert(
          response.status === (firstFault?.status ?? 'completed') &&
            rustEqual(response.diagnostic, firstFault?.diagnostic ?? null),
        );
        selected = judgement.cases[request.reviewCase];
        replayInput = profile.cases[request.reviewCase].input;
        rustAssert((selected !== undefined) === (response.replay !== null));
      } else rustAssert(response.status !== 'completed' && response.replay === null);
    } else {
      rustAssert(response.judgement === null);
      if (request.operation === 'execute') {
        replayInput = request.input;
        if (response.status === 'completed') rustAssert(response.replay !== null);
      }
    }
    if (response.replay) {
      rustAssert(replayInput !== undefined);
      const replay = response.replay;
      const expectedStatus = selected?.status ?? response.status;
      const expectedDiagnostic = selected ? selected.diagnostic : response.diagnostic;
      rustAssert(
        replay.terminal.status === expectedStatus &&
          rustEqual(replay.terminal.diagnostic, expectedDiagnostic),
      );
      diagnostic(replay.terminal.status, replay.terminal.diagnostic);
      rustAssert(
        replay.terminal.cursor === replay.trace.steps.length &&
          (replay.trace.completeness === 'complete') === (replay.terminal.status === 'completed'),
      );
      const counted = await consume(verifyRustTrace(replay.trace, nodes, replayInput), guard);
      if (request.operation === 'execute') {
        rustAssert(
          response.usage.steps === counted.steps &&
            response.usage.objects === counted.objects &&
            response.usage.outputBytes === counted.outputBytes &&
            response.usage.resultBytes === counted.resultBytes,
        );
      } else {
        rustAssert(
          response.usage.steps >= counted.steps &&
            response.usage.objects >= counted.objects &&
            response.usage.outputBytes >= counted.outputBytes &&
            response.usage.resultBytes >= counted.resultBytes,
        );
        if (selected?.passed && request.operation === 'judge') {
          rustAssert(
            counted.state.output ===
              profiles.get(request.profile)!.cases[request.reviewCase].expected &&
              counted.state.control.inputCursor === bytes(replayInput),
          );
        }
      }
      if (replay.terminal.status === 'completed')
        rustAssert(
          counted.state.frames.length === 0 &&
            counted.state.bindings.length === 0 &&
            counted.state.loans.length === 0 &&
            counted.state.temporaries.length === 0 &&
            counted.state.objects.every((object) => !object.alive) &&
            counted.state.allocator.liveBytes === 0,
        );
    } else if (request.operation !== 'judge' || response.judgement === null) {
      rustAssert(
        response.usage.steps === 0 &&
          response.usage.objects === 0 &&
          response.usage.outputBytes === 0 &&
          response.usage.resultBytes === 0,
      );
    }
    rustAssert(
      response.usage.fuel >= response.usage.steps && response.usage.objects <= response.usage.steps,
    );
    guard();
    return response;
  } catch (error) {
    if (error instanceof Error && ['E_DEADLINE', 'E_CANCELLED'].includes(error.message))
      throw error;
    throw new Error('E_PROTOCOL_INVALID', { cause: error });
  }
}
