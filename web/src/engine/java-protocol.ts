import { validateRequest, validateResponse } from '../generated/java/protocol.mjs';
import registry from '../../../content/java/judges-1.0.0.json?raw';
import { c6Assert as assert, c6Equal as equal } from './c6-player';
import { canonicalC6Json } from './c6-protocol';
import { precheckJson } from './execution-json';
import { yieldTask } from './protocol';
import { verifyJavaTrace } from './java-player';
import type {
  JavaNode,
  JavaOperation,
  JavaPacket,
  JavaRequest,
  JavaResponse,
  JavaRange,
} from './java-types';

const utf8 = new TextEncoder();
const size = (text: string) => utf8.encode(text).byteLength;
const profiles = new Map(
  (JSON.parse(registry) as { id: string; cases: [string, string][] }[]).map(({ id, cases }) => [
    id,
    cases,
  ]),
);
export const javaPackage = { id: 'content.java.runoob', version: '1.0.0' } as const;
export function javaJudgeInput(id: string, caseKey: number) {
  return profiles.get(id)?.[caseKey - 1]?.[0];
}

export async function javaRequest(
  source: string,
  operation: JavaOperation,
  sourceRevision: string = crypto.randomUUID(),
): Promise<JavaRequest> {
  if (source.length > 32768) throw new Error('E_SOURCE_LIMIT');
  const sourceBytes = utf8.encode(source);
  if (sourceBytes.byteLength > 32768) throw new Error('E_SOURCE_LIMIT');
  const digest = await crypto.subtle.digest('SHA-256', sourceBytes);
  return {
    language: 'java',
    engineId: 'engine.rust.java',
    engineVersion: '0.1.0',
    javaReference: '21',
    execVersion: '1.7.0',
    dslVersion: '1.6.0',
    diagnosticVersion: '1.6.0',
    integerEncoding: '1.1.0',
    runId: crypto.randomUUID(),
    sourceRevision,
    sourceSha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    source,
    operation,
  };
}

export function encodeJavaRequest(request: JavaRequest): Uint8Array<ArrayBuffer> {
  assert(validateRequest(request));
  if (size(request.source) > 32768) throw new Error('E_SOURCE_LIMIT');
  if (request.operation.kind === 'run' && size(request.operation.input.text) > 256) {
    throw new Error('E_INPUT_LIMIT');
  }
  const bytes = utf8.encode(canonicalC6Json(request));
  if (bytes.byteLength > 65536) throw new Error('E_REQUEST_LIMIT');
  return bytes;
}

export function javaPositions(source: string) {
  const positions = new Map<number, { line: number; column: number; utf16Offset: number }>();
  let byte = 0,
    line = 1,
    column = 1,
    at = 0;
  positions.set(0, { line, column, utf16Offset: 0 });
  while (at < source.length) {
    const point = source.codePointAt(at)!;
    if (point === 13 || point === 10) {
      const width = point === 13 && source.charCodeAt(at + 1) === 10 ? 2 : 1;
      byte += width;
      at += width;
      line++;
      column = 1;
    } else {
      at += point > 65535 ? 2 : 1;
      byte += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      column++;
    }
    positions.set(byte, { line, column, utf16Offset: at });
  }
  return positions;
}

async function consume<T>(steps: Generator<void, T>, guard: () => void): Promise<T> {
  let slice = performance.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    guard();
    if (performance.now() - slice > 6) {
      await yieldTask();
      guard();
      slice = performance.now();
    }
  }
}

export async function decodeJavaResponse(
  bytes: ArrayBuffer,
  request: JavaRequest,
  build: string,
  guard: () => void,
): Promise<JavaResponse> {
  assert(bytes.byteLength > 0 && bytes.byteLength <= 16_777_216);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  await consume(precheckJson(text), guard);
  const raw: unknown = JSON.parse(text);
  assert(validateResponse(raw));
  guard();
  const response = raw as JavaResponse;
  assert(
    response.engineBuildSha256 === build &&
      response.runId === request.runId &&
      response.sourceRevision === request.sourceRevision &&
      response.sourceSha256 === request.sourceSha256 &&
      response.result.kind === request.operation.kind &&
      response.usage.resultBytes === bytes.byteLength,
  );
  const positions = javaPositions(request.source);
  const range = ({ start, end }: JavaRange) =>
    assert(start <= end && positions.has(start) && positions.has(end));
  const nodes = new Map<number, JavaNode>();
  for (const [index, node] of response.nodeMap.entries()) {
    assert(node.nodeId === index + 1);
    range(node.byteRange);
    nodes.set(node.nodeId, node);
  }
  const total = { steps: 0, objects: 0, outputBytes: 0 };
  const inspect = async (packet: JavaPacket, input: string) => {
    const { terminal, trace } = packet;
    assert((terminal.status === 'completed') === (terminal.diagnostic === null));
    if (terminal.diagnostic) range(terminal.diagnostic.byteRange);
    if (!trace) {
      assert(terminal.cursor === 0 && terminal.status !== 'completed');
      return '';
    }
    assert(
      trace.steps.length === terminal.cursor &&
        (trace.completeness === 'complete') === (terminal.status === 'completed'),
    );
    const counted = await consume(verifyJavaTrace(trace, nodes, size(input)), guard);
    total.steps += counted.steps;
    total.objects += counted.objects;
    total.outputBytes += counted.outputBytes;
    return counted.output;
  };
  const operation = request.operation;
  const result = response.result;
  if (operation.kind === 'run' && result.kind === 'run')
    await inspect(result.packet, operation.input.text);
  if (operation.kind === 'judge' && result.kind === 'judge') {
    assert(
      equal(operation.profileRef, result.profileRef) &&
        equal(operation.packageRef, result.packageRef),
    );
    const cases = profiles.get(result.profileRef.id);
    assert(cases);
    if (result.diagnostic) {
      range(result.diagnostic.byteRange);
      assert(result.status === 'incomplete' && !result.cases.length);
    }
    for (const [index, group] of result.cases.entries()) {
      const [input, expected] = cases[index];
      assert(group.caseKey === index + 1);
      assert(index < cases.length);
      const output = await inspect(group.packet, input);
      assert(
        group.stdoutMatches ===
          (group.packet.terminal.status === 'completed' && output === expected),
      );
      if (group.observationMatches) {
        assert(group.packet.terminal.status === 'completed' && group.observations.length);
      } else assert(group.observations.length === 0);
      let last = 0;
      for (const fact of group.observations) {
        const step = group.packet.trace?.steps[fact.seq - 1];
        assert(
          step &&
            fact.seq > last &&
            fact.nodeId === step.nodeId &&
            fact.tag === step.kind &&
            equal(fact.value, step.value),
        );
        last = fact.seq;
      }
    }
    const incomplete =
      result.diagnostic ||
      result.cases.length < 4 ||
      result.cases.some(
        ({ packet }) =>
          packet.terminal.status === 'limited' || packet.terminal.status === 'cancelled',
      );
    assert(
      result.status ===
        (incomplete
          ? 'incomplete'
          : result.cases.every((group) => group.stdoutMatches && group.observationMatches)
            ? 'passed'
            : 'failed'),
    );
  }
  if (operation.kind === 'edit' && result.kind === 'edit') {
    assert(
      result.documentId === operation.documentId && equal(result.packageRef, operation.packageRef),
    );
    if (result.diagnostic) range(result.diagnostic.byteRange);
    assert(
      result.status === 'mapped'
        ? equal(result.blockMap, response.nodeMap)
        : result.blockMap.length === 0,
    );
  }
  assert(
    total.steps === response.usage.steps &&
      total.objects === response.usage.objects &&
      total.outputBytes === response.usage.outputBytes,
  );
  guard();
  return response;
}
