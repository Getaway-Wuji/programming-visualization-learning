import { mysqlProtocol } from '../../../shared/contracts/mysql-execution.mjs';
import { validateRequest, validateResponse } from '../generated/mysql/protocol.mjs';
import {
  canonicalMysqlJson,
  initialMysqlState,
  mysqlAssert,
  mysqlBytes,
  mysqlCaseReason,
  mysqlEqual,
  mysqlJsonBytes,
  mysqlJudgeSession,
  mysqlProfile,
  mysqlProfileIds,
  validateMysqlSession,
} from './mysql-data';
import { verifyMysqlTrace } from './mysql-player';
import { precheckJson } from './execution-json';
import { yieldTask } from './protocol';
import type {
  MysqlCaseResult,
  MysqlDiagnostic,
  MysqlNode,
  MysqlOperation,
  MysqlRange,
  MysqlRequest,
  MysqlResponse,
  MysqlStatus,
} from './mysql-types';
export { mysqlProtocol, canonicalMysqlJson };
export type * from './mysql-types';
const encoder = new TextEncoder();
export function mysqlPositions(source: string) {
  const result = new Map<number, { line: number; column: number; utf16Offset: number }>();
  let byte = 0,
    line = 1,
    column = 1,
    offset = 0;
  result.set(0, { line, column, utf16Offset: offset });
  for (const scalar of source) {
    byte += mysqlBytes(scalar);
    offset += scalar.length;
    if (scalar === '\n') {
      line++;
      column = 1;
    } else column++;
    result.set(byte, { line, column, utf16Offset: offset });
  }
  return result;
}
export function encodeMysqlRequest(request: MysqlRequest): Uint8Array<ArrayBuffer> {
  if (
    typeof request.source !== 'string' ||
    request.source.length > mysqlProtocol.sourceBytes ||
    mysqlBytes(request.source) > mysqlProtocol.sourceBytes
  )
    throw new Error('E_SOURCE_LIMIT');
  if (
    new TextDecoder().decode(encoder.encode(request.source)) !== request.source ||
    !validateRequest(request)
  )
    throw new Error('E_REQUEST_INVALID');
  if (request.operation === 'execute') {
    try {
      validateMysqlSession(request.session);
    } catch (error) {
      throw new Error('E_SESSION_INVALID', { cause: error });
    }
  } else if (!mysqlProfileIds.includes(request.profile)) throw new Error('E_PROFILE_UNKNOWN');
  const encoded = encoder.encode(canonicalMysqlJson(request));
  if (encoded.byteLength > mysqlProtocol.requestBytes) throw new Error('E_REQUEST_INVALID');
  return encoded;
}
export function mysqlRequest(source: string, operation: MysqlOperation, revision?: string) {
  const request: MysqlRequest = {
    version: '1.0.0',
    language: 'mysql',
    dialect: '8.0',
    runId: crypto.randomUUID(),
    sourceRevision: revision ?? crypto.randomUUID(),
    source,
    ...structuredClone(operation),
  };
  return { request, bytes: encodeMysqlRequest(request) };
}
async function consume<T>(generator: Generator<void, T, unknown>, guard: () => void) {
  let deadline = performance.now() + 4;
  while (true) {
    guard();
    const next = generator.next();
    if (next.done) return next.value;
    if (performance.now() >= deadline) {
      await yieldTask();
      guard();
      deadline = performance.now() + 4;
    }
  }
}
export async function decodeMysqlResponse(
  buffer: ArrayBuffer,
  request: MysqlRequest,
  buildId: string,
  guard: () => void,
): Promise<MysqlResponse> {
  try {
    guard();
    mysqlAssert(validateRequest(request));
    mysqlAssert(buffer.byteLength > 0 && buffer.byteLength <= mysqlProtocol.resultBytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    await consume(precheckJson(text), guard);
    const raw: unknown = JSON.parse(text);
    mysqlAssert(validateResponse(raw));
    const response = raw as MysqlResponse;
    mysqlAssert(
      response.buildId === buildId &&
        response.operation === request.operation &&
        response.version === request.version &&
        response.language === request.language &&
        response.dialect === request.dialect &&
        response.identity.runId === request.runId &&
        response.identity.sourceRevision === request.sourceRevision,
    );
    mysqlAssert(response.usage.resultBytes === buffer.byteLength);
    const positions = mysqlPositions(request.source);
    const range = (value: MysqlRange) =>
      mysqlAssert(
        value.start <= value.end && positions.has(value.start) && positions.has(value.end),
      );
    const diagnostic = (status: MysqlStatus, item: MysqlDiagnostic | null) => {
      mysqlAssert((status === 'completed') === (item === null));
      if (item) {
        range(item.byteRange);
        mysqlAssert(
          (status === 'limited') === (item.code.endsWith('_LIMIT') || item.code === 'E_DEADLINE'),
        );
      }
    };
    diagnostic(response.status, response.diagnostic);
    const nodes = new Map<number, MysqlNode>();
    let previousEnd = 0;
    for (const [index, node] of response.nodeMap.entries()) {
      range(node.byteRange);
      mysqlAssert(
        node.id === index + 1 &&
          node.byteRange.start >= previousEnd &&
          node.byteRange.end > node.byteRange.start,
      );
      nodes.set(node.id, node);
      previousEnd = node.byteRange.end;
    }
    const session =
      request.operation === 'execute'
        ? request.session
        : mysqlJudgeSession(request.profile, request.reviewCase);
    let selected: MysqlCaseResult | undefined;
    if (request.operation === 'execute') {
      mysqlAssert(response.judgement === null);
      if (response.status === 'completed') mysqlAssert(response.replay !== null);
    } else if (response.judgement) {
      const judgement = response.judgement;
      mysqlAssert(
        judgement.reviewCase === request.reviewCase && judgement.cases.length > 0 && session,
      );
      for (const [index, item] of judgement.cases.entries()) {
        mysqlAssert(item.index === index);
        diagnostic(item.status, item.diagnostic);
        mysqlAssert(item.passed === (item.reason === 'passed'));
        if (item.status === 'completed')
          mysqlAssert(!['program-error', 'limited'].includes(item.reason));
        else
          mysqlAssert(
            !item.passed &&
              item.reason === (item.status === 'limited' ? 'limited' : 'program-error'),
          );
        if (item.status === 'limited') mysqlAssert(index === judgement.cases.length - 1);
      }
      const limited = judgement.cases.at(-1)?.status === 'limited';
      mysqlAssert(judgement.complete === (judgement.cases.length === 4 && !limited));
      mysqlAssert(judgement.complete || limited);
      mysqlAssert(
        judgement.passed === (judgement.complete && judgement.cases.every((item) => item.passed)),
      );
      mysqlAssert(
        response.status === (limited ? 'limited' : 'completed') &&
          mysqlEqual(response.diagnostic, limited ? judgement.cases.at(-1)!.diagnostic : null),
      );
      selected = judgement.cases[request.reviewCase];
      mysqlAssert((selected !== undefined) === (response.replay !== null));
    } else mysqlAssert(response.status !== 'completed' && response.replay === null);
    if (response.replay) {
      mysqlAssert(session);
      const replay = response.replay;
      mysqlAssert(mysqlJsonBytes(replay.trace) <= mysqlProtocol.traceBytes);
      mysqlAssert(
        replay.terminal.status === (selected?.status ?? response.status) &&
          mysqlEqual(
            replay.terminal.diagnostic,
            selected ? selected.diagnostic : response.diagnostic,
          ),
      );
      diagnostic(replay.terminal.status, replay.terminal.diagnostic);
      mysqlAssert(
        replay.terminal.cursor === replay.trace.steps.length &&
          (replay.trace.completeness === 'complete') === (replay.terminal.status === 'completed'),
      );
      mysqlAssert(mysqlEqual(replay.trace.initialState, initialMysqlState(session)));
      const counted = await consume(
        verifyMysqlTrace(replay.trace, nodes, session, replay.features),
        guard,
      );
      mysqlAssert(
        response.usage.steps >= counted.steps &&
          response.usage.databaseBytes >= counted.databaseBytes,
      );
      if (request.operation === 'execute') mysqlAssert(response.usage.steps === counted.steps);
      else if (selected?.status === 'completed') {
        const expected = mysqlProfile(request.profile)!.cases[request.reviewCase];
        const reason = mysqlCaseReason(counted.state, replay.features, expected, counted.evidence);
        mysqlAssert(selected.reason === reason && selected.passed === (reason === 'passed'));
      }
    } else if (!response.judgement)
      mysqlAssert(response.usage.steps === 0 && response.usage.rowsExamined === 0);
    mysqlAssert(
      response.usage.fuel >= response.usage.steps &&
        response.usage.rowsExamined <= response.usage.fuel,
    );
    guard();
    return response;
  } catch (error) {
    if (error instanceof Error && ['E_DEADLINE', 'E_CANCELLED'].includes(error.message))
      throw error;
    throw new Error('E_PROTOCOL_INVALID', { cause: error });
  }
}
