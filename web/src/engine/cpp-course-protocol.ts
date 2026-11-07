import { cppCourseProtocol } from '../../../shared/contracts/cpp-course-execution.mjs';
import {
  advancedAssert,
  canonicalAdvancedJson,
  validateAdvancedPacket,
  type AdvancedNode,
  type AdvancedRequest,
  type AdvancedResult,
} from './advanced-protocol';
import { precheckJson } from './execution-json';
import { yieldTask } from './protocol';

export { cppCourseProtocol };
export type CppInput = AdvancedRequest['input'];
export type CppOperation =
  | { operation: 'execute'; input: CppInput }
  | { operation: 'analyze' }
  | { operation: 'judge'; profile: string; reviewCase: number };
export type CppCourseRequest = CppOperation & {
  version: '1.0.0';
  language: 'cpp';
  runId: string;
  sourceRevision: string;
  source: string;
};
type CppStatus = 'completed' | 'error' | 'limited';
export interface CppDiagnostic {
  code: string;
  byteRange: { start: number; end: number };
}
export interface CppCourseResponse {
  version: '1.0.0';
  language: 'cpp';
  operation: CppOperation['operation'];
  buildId: string;
  identity: { runId: string; sourceRevision: string };
  status: CppStatus;
  diagnostic: CppDiagnostic | null;
  nodeMap: AdvancedNode[];
  judgement: {
    passed: boolean;
    reviewCase: number;
    cases: {
      index: number;
      status: CppStatus;
      passed: boolean;
      diagnostic: CppDiagnostic | null;
    }[];
  } | null;
  replay: AdvancedResult | null;
}

export function cppRequest(source: string, operation: CppOperation, revision: string) {
  const request: CppCourseRequest = {
    version: cppCourseProtocol.version,
    language: cppCourseProtocol.language,
    runId: crypto.randomUUID(),
    sourceRevision: revision,
    source,
    ...operation,
  };
  const bytes = new TextEncoder().encode(canonicalAdvancedJson(request));
  if (bytes.byteLength > cppCourseProtocol.requestBytes) throw new Error('E_REQUEST_LIMIT');
  return { request, bytes };
}

function exact(value: unknown, keys: string[]): void {
  advancedAssert(value && typeof value === 'object' && !Array.isArray(value));
  advancedAssert(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
  );
}

export async function decodeCppResponse(
  buffer: ArrayBuffer,
  request: CppCourseRequest,
  buildId: string,
  input: CppInput,
  guard: () => void,
): Promise<CppCourseResponse> {
  advancedAssert(buffer.byteLength > 0 && buffer.byteLength <= cppCourseProtocol.resultBytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  let until = performance.now() + 6;
  const lexical = precheckJson(text);
  for (let step = lexical.next(); !step.done; step = lexical.next()) {
    guard();
    if (performance.now() >= until) {
      await yieldTask();
      guard();
      until = performance.now() + 6;
    }
  }
  const response = JSON.parse(text) as CppCourseResponse;
  exact(response, [
    'version',
    'language',
    'operation',
    'buildId',
    'identity',
    'status',
    'diagnostic',
    'nodeMap',
    'judgement',
    'replay',
  ]);
  exact(response.identity, ['runId', 'sourceRevision']);
  advancedAssert(
    response.version === request.version &&
      response.language === request.language &&
      response.operation === request.operation &&
      response.buildId === buildId &&
      response.identity.runId === request.runId &&
      response.identity.sourceRevision === request.sourceRevision,
  );
  const sourceBytes = new TextEncoder().encode(request.source);
  const boundary = (n: number) =>
    Number.isInteger(n) &&
    n >= 0 &&
    n <= sourceBytes.length &&
    (n === sourceBytes.length || (sourceBytes[n] & 0xc0) !== 0x80);
  const range = (value: CppDiagnostic['byteRange']) => {
    exact(value, ['start', 'end']);
    advancedAssert(boundary(value.start) && boundary(value.end) && value.start <= value.end);
  };
  const status = (state: CppStatus, item: CppDiagnostic | null) => {
    advancedAssert(
      ['completed', 'error', 'limited'].includes(state) &&
        (item === null) === (state === 'completed'),
    );
    if (item) {
      exact(item, ['code', 'byteRange']);
      advancedAssert(/^E_[A-Z_]+$/.test(item.code));
      range(item.byteRange);
    }
  };
  status(response.status, response.diagnostic);
  advancedAssert(Array.isArray(response.nodeMap));
  if (request.operation === 'analyze') {
    advancedAssert(response.replay === null && response.judgement === null);
    response.nodeMap.forEach((node, index) => {
      exact(node, ['nodeId', 'kind', 'byteRange']);
      advancedAssert(node.nodeId === `n${index + 1}` && /^[a-z-]+$/.test(node.kind));
      range(node.byteRange);
    });
  } else advancedAssert(response.nodeMap.length === 0);
  if (response.judgement) {
    const { passed, reviewCase, cases } = response.judgement;
    exact(response.judgement, ['passed', 'reviewCase', 'cases']);
    advancedAssert(
      request.operation === 'judge' &&
        reviewCase === request.reviewCase &&
        typeof passed === 'boolean' &&
        Array.isArray(cases) &&
        cases.length > 0 &&
        cases.length <= 4,
    );
    cases.forEach((group, index) => {
      exact(group, ['index', 'status', 'passed', 'diagnostic']);
      advancedAssert(
        group.index === index &&
          typeof group.passed === 'boolean' &&
          (!group.passed || group.status === 'completed'),
      );
      status(group.status, group.diagnostic);
    });
    advancedAssert(passed === (cases.length === 4 && cases.every((group) => group.passed)));
    if (response.status === 'completed') advancedAssert(cases.length === 4);
  } else advancedAssert(request.operation !== 'judge' || response.status !== 'completed');
  if (response.replay) {
    await validateAdvancedPacket(
      response.replay,
      {
        execVersion: '1.4.0',
        dslVersion: '1.3.0',
        diagnosticVersion: '1.3.0',
        integerEncoding: '1.0.0',
        language: 'cpp',
        engineId: 'engine.rust.advanced',
        runId: request.runId,
        sourceRevision: request.sourceRevision,
        source: request.source,
        input,
      },
      buildId,
      guard,
      true,
    );
    const expected =
      request.operation === 'judge'
        ? response.judgement?.cases[request.reviewCase]?.status
        : response.status;
    advancedAssert(response.replay.terminal.status === expected);
  }
  guard();
  return response;
}
