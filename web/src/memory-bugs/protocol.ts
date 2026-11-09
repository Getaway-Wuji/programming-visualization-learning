import { outputsMatch, recordedOutput } from '../practice/output-policy';
import {
  MemoryExecutionClient,
  memoryRequest,
  type MemoryDependencies,
} from '../engine/memory-client';
import {
  canonicalMemoryJson,
  decodeMemoryResult,
  encodeMemoryRequest,
  memoryAssert,
  type MemoryRequest,
  type MemoryResult,
} from '../engine/memory-protocol';
import { precheckJson } from '../engine/execution-json';
import { memoryModuleStore } from '../engine/memory-module';
import { memoryBugQuestion, memoryBugRegistry, type MemoryBugQuestion } from './content';

export interface MemoryBugRequest extends MemoryRequest {
  bug: { version: '1.0.0'; exerciseId: string; caseKey: string };
}
export interface BugJudgement {
  version: '1.0.0';
  registryRef: { id: string; version: string };
  exerciseRef: { id: string; version: string };
  caseKey: string;
  status: 'met' | 'unmet';
  checks: { id: string; met: boolean }[];
}
const judgements = new WeakMap<MemoryResult, BugJudgement>();
const accepted = new WeakSet<MemoryResult>();
const bindings = new WeakMap<
  MemoryResult,
  Readonly<{ source: string; sourceRevision: string; exerciseId: string; caseKey: string }>
>();
export const acceptedBugJudgement = (result: MemoryResult) =>
  accepted.has(result) ? judgements.get(result) : undefined;
export const acceptedBugBinding = (result: MemoryResult) =>
  accepted.has(result) ? bindings.get(result) : undefined;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const exact = (v: unknown, fields: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === fields.length &&
  fields.every((k) => k in v);
export function bugRequest(
  question: MemoryBugQuestion,
  source: string,
  caseKey: string,
  revision: string,
): MemoryBugRequest {
  const test = question.tests.find((t) => t.caseKey === caseKey);
  memoryAssert(test);
  return {
    ...memoryRequest(source, 'cpp', test.input, revision),
    bug: { version: '1.0.0', exerciseId: question.exerciseRef.id, caseKey },
  };
}
export const encodeBugRequest: typeof encodeMemoryRequest = (value) => {
  const request = value as MemoryBugRequest;
  const { bug, ...base } = request;
  encodeMemoryRequest(base);
  memoryAssert(exact(bug, ['version', 'exerciseId', 'caseKey']) && bug.version === '1.0.0');
  const q = memoryBugQuestion(bug.exerciseId),
    test = q?.tests.find((t) => t.caseKey === bug.caseKey);
  memoryAssert(
    q &&
      test &&
      request.language === 'cpp' &&
      canonicalMemoryJson(test.input) === canonicalMemoryJson(request.input),
  );
  const bytes = new TextEncoder().encode(canonicalMemoryJson(request));
  memoryAssert(bytes.length <= 65536);
  return bytes;
};
export const decodeBugResult: typeof decodeMemoryResult = async (
  buffer,
  value,
  buildId,
  guard = () => undefined,
) => {
  const request = value as MemoryBugRequest;
  memoryAssert(buffer.byteLength <= 16777216);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    prefix = '{"bugJudgement":';
  memoryAssert(text.startsWith(prefix));
  // Canonical Rust metadata puts this bounded companion first; the original
  // multi-megabyte trace is validated once, without reparsing/re-serializing it.
  const boundary = text.indexOf(',"diagnosticVersion":', prefix.length);
  memoryAssert(boundary > prefix.length && boundary < 4096);
  const head = text.slice(prefix.length, boundary);
  for (const _ of precheckJson(head)) {
    void _;
    guard();
  }
  const judgement = JSON.parse(head) as BugJudgement;
  memoryAssert(
    exact(judgement, ['version', 'registryRef', 'exerciseRef', 'caseKey', 'status', 'checks']),
  );
  const q = memoryBugQuestion(request.bug.exerciseId);
  memoryAssert(
    q &&
      exact(judgement.registryRef, ['id', 'version']) &&
      exact(judgement.exerciseRef, ['id', 'version']) &&
      judgement.version === '1.0.0' &&
      judgement.registryRef.id === memoryBugRegistry.registryRef.id &&
      judgement.registryRef.version === memoryBugRegistry.registryRef.version &&
      judgement.exerciseRef.id === q.exerciseRef.id &&
      judgement.exerciseRef.version === q.exerciseRef.version &&
      judgement.caseKey === request.bug.caseKey &&
      ['met', 'unmet'].includes(judgement.status),
  );
  const ids = ['exit-zero', 'stdout-exact', 'input-consumed', 'teaching-target'];
  memoryAssert(
    Array.isArray(judgement.checks) &&
      judgement.checks.length === 4 &&
      judgement.checks.every(
        (c, i) => exact(c, ['id', 'met']) && c.id === ids[i] && typeof c.met === 'boolean',
      ),
  );
  memoryAssert((judgement.status === 'met') === judgement.checks.every((c) => c.met));
  guard();
  const { bug: _, ...base } = request;
  void _;
  const bytes = new TextEncoder().encode('{' + text.slice(boundary + 1));
  const result = await decodeMemoryResult(bytes.buffer, base, buildId, guard);
  memoryAssert(
    judgement.status !== 'met' ||
      (result.terminal.status === 'completed' &&
        result.terminal.returnValue === 0 &&
        result.trace?.completeness === 'complete'),
  );
  const test = q.tests.find((row) => row.caseKey === request.bug.caseKey)!;
  const checks = judgement.checks.map((check) =>
    check.id === 'stdout-exact' && result.trace
      ? { ...check, met: outputsMatch(recordedOutput(result.trace), test.expectedStdout) }
      : { ...check },
  );
  guard();
  judgements.set(
    result,
    freeze({
      ...judgement,
      checks,
      status:
        result.terminal.status === 'completed' &&
        result.terminal.returnValue === 0 &&
        result.trace?.completeness === 'complete' &&
        checks.every((check) => check.met)
          ? 'met'
          : 'unmet',
    }),
  );
  return result;
};
export class MemoryBugClient {
  private readonly client: MemoryExecutionClient;
  constructor(dependencies: MemoryDependencies = {}) {
    this.client = new MemoryExecutionClient({
      moduleStore: Object.keys(dependencies).length ? undefined : memoryModuleStore,
      encode: encodeBugRequest,
      decode: decodeBugResult,
      createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      ...dependencies,
    });
  }
  async execute(request: MemoryBugRequest, started: number) {
    const snapshot = structuredClone(request);
    const result = await this.client.execute(snapshot, { started });
    memoryAssert(judgements.has(result));
    bindings.set(
      result,
      Object.freeze({
        source: snapshot.source,
        sourceRevision: snapshot.sourceRevision,
        exerciseId: snapshot.bug.exerciseId,
        caseKey: snapshot.bug.caseKey,
      }),
    );
    accepted.add(result);
    return result;
  }
  invalidate() {
    this.client.invalidate();
  }
  cancel() {
    this.client.cancel();
  }
}
