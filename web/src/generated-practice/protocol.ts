import { precheckJson } from '../engine/execution-json';
import {
  decodeAdvancedResult,
  canonicalAdvancedJson,
  encodeAdvancedRequest,
  type AdvancedRequest,
  type AdvancedResult,
} from '../engine/advanced-protocol';
export const practiceKnowledgeIds = [
  'knowledge.c.expressions',
  'knowledge.c.variables',
  'knowledge.c.output',
  'knowledge.c.input',
  'knowledge.c.conditions',
  'knowledge.c.loops',
] as const;
export interface Selection {
  knowledgeId: string;
  difficulty: 1 | 2;
  seed: string;
}
interface BaseRequest extends Selection {
  generatorVersion: '1.0.0';
  requestId: string;
}
export type PracticeRequest =
  | (BaseRequest & { operation: 'generate' })
  | (BaseRequest & {
      operation: 'grade' | 'preview';
      problemId: string;
      attemptId: string;
      sourceRevision: string;
      source: string;
      inputText?: string;
    });
export interface PracticeCase {
  caseId: string;
  inputText: string;
  expectedStdout: string;
}
export interface GeneratedProblem {
  problemVersion: '1.0.0';
  problemId: string;
  templateRef: { id: string; version: '1.0.0' };
  language: 'c';
  difficulty: 1 | 2;
  seed: string;
  knowledgeIds: string[];
  title: string;
  prompt: string;
  parameters: Record<string, number | null>;
  inputMin: number;
  inputMax: number;
  cases: PracticeCase[];
  starterSource: string;
  referenceSource: string;
  validation: { checkedCases: number; fuelUsed: number };
}
export interface CaseOutcome extends PracticeCase {
  actualStdout: string;
  status: 'passed' | 'wrong-answer' | 'program-error' | 'resource-limit';
  code: string | null;
}
export interface Assessment {
  problemId: string;
  attemptId: string;
  sourceRevision: string;
  complete: boolean;
  verdict: 'passed' | 'unmet' | 'rejected' | 'limited';
  totalCases: number;
  checkedCases: number;
  passedCases: number;
  results: CaseOutcome[];
  replay: { caseId: string; inputText: string; request: AdvancedRequest; result: AdvancedResult };
}
interface BaseResponse {
  generatorVersion: '1.0.0';
  producer: 'rust';
  buildId: string;
  requestId: string;
  stats: { fuelUsed: number; steps: number; outputBytes: number };
}
export type PracticeResponse =
  | (BaseResponse & { operation: 'generate'; problem: GeneratedProblem })
  | (BaseResponse & { operation: 'grade' | 'preview'; assessment: Assessment });
export function practiceAssert(valid: unknown): asserts valid {
  if (!valid) throw new Error('E_PROTOCOL_INVALID');
}
function keys(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  practiceAssert(value && typeof value === 'object' && !Array.isArray(value));
  const names = Object.keys(value);
  practiceAssert(names.length === fields.length && fields.every((k) => Object.hasOwn(value, k)));
}
const safe = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
const integer = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
const id = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(s);
const text = (s: unknown, max: number): s is string =>
  typeof s === 'string' && new TextEncoder().encode(s).byteLength <= max;
const canonicalSeed = (seed: string) => {
  practiceAssert(/^[0-9]{1,10}$/.test(seed) && BigInt(seed) <= 4294967295n);
  return BigInt(seed).toString();
};
const templateFor = (knowledge: string) =>
  knowledge === 'knowledge.c.conditions'
    ? 'generated.c.interval'
    : knowledge === 'knowledge.c.loops'
      ? 'generated.c.accumulate'
      : 'generated.c.affine';
export function encodePracticeRequest(request: PracticeRequest): Uint8Array<ArrayBuffer> {
  const fields = [
    'generatorVersion',
    'requestId',
    'operation',
    'knowledgeId',
    'difficulty',
    'seed',
  ];
  if (request.operation !== 'generate') {
    fields.push('problemId', 'attemptId', 'sourceRevision', 'source');
    if (request.operation === 'preview') fields.push('inputText');
  }
  keys(request, fields);
  practiceAssert(
    request.generatorVersion === '1.0.0' &&
      id(request.requestId) &&
      ['generate', 'grade', 'preview'].includes(request.operation) &&
      text(request.knowledgeId, 96) &&
      [1, 2].includes(request.difficulty) &&
      text(request.seed, 32),
  );
  if (request.operation !== 'generate') {
    practiceAssert(
      id(request.attemptId) &&
        request.attemptId.length <= 70 &&
        id(request.sourceRevision) &&
        text(request.problemId, 128) &&
        typeof request.source === 'string',
    );
    if (new TextEncoder().encode(request.source).length > 32768) throw new Error('E_SOURCE_LIMIT');
    if (request.operation === 'preview') practiceAssert(text(request.inputText, 256));
  }
  const bytes = new TextEncoder().encode(canonicalAdvancedJson(request));
  if (bytes.byteLength > 65536) throw new Error('E_REQUEST_LIMIT');
  return bytes;
}
function checkCase(value: PracticeCase, problemId: string, input: string) {
  keys(value, ['caseId', 'inputText', 'expectedStdout']);
  practiceAssert(
    value.caseId === `${problemId}:input:${input}` &&
      value.inputText === input &&
      /^-?(?:0|[1-9][0-9]{0,9})\n$/.test(value.expectedStdout) &&
      value.expectedStdout !== '-0\n',
  );
}
function checkProblem(p: GeneratedProblem, request: PracticeRequest) {
  keys(p, [
    'problemVersion',
    'problemId',
    'templateRef',
    'language',
    'difficulty',
    'seed',
    'knowledgeIds',
    'title',
    'prompt',
    'parameters',
    'inputMin',
    'inputMax',
    'cases',
    'starterSource',
    'referenceSource',
    'validation',
  ]);
  keys(p.templateRef, ['id', 'version']);
  keys(p.validation, ['checkedCases', 'fuelUsed']);
  const template = templateFor(request.knowledgeId),
    seed = canonicalSeed(request.seed),
    small = request.difficulty === 1;
  practiceAssert(
    practiceKnowledgeIds.some((id) => id === request.knowledgeId) &&
      p.problemVersion === '1.0.0' &&
      p.templateRef.id === template &&
      p.templateRef.version === '1.0.0' &&
      p.language === 'c' &&
      p.difficulty === request.difficulty &&
      p.seed === seed &&
      p.problemId === `${template}@1.0.0:d${request.difficulty}:s${seed}`,
  );
  const expectedKnowledge =
    template === 'generated.c.affine' ? practiceKnowledgeIds.slice(0, 4) : [request.knowledgeId];
  practiceAssert(JSON.stringify(p.knowledgeIds) === JSON.stringify(expectedKnowledge));
  practiceAssert(
    p.inputMin === (template === 'generated.c.accumulate' ? 0 : small ? -6 : -12) &&
      p.inputMax === (template === 'generated.c.accumulate' ? (small ? 5 : 9) : small ? 6 : 12) &&
      Array.isArray(p.cases) &&
      p.cases.length === p.inputMax - p.inputMin + 1,
  );
  practiceAssert(
    text(p.title, 160) &&
      text(p.prompt, 4096) &&
      text(p.starterSource, 32768) &&
      text(p.referenceSource, 32768) &&
      p.validation.checkedCases === p.cases.length &&
      safe(p.validation.fuelUsed, 1000000),
  );
  p.cases.forEach((c, i) => checkCase(c, p.problemId, String(p.inputMin + i)));
  const parameters = p.parameters;
  keys(
    parameters,
    template === 'generated.c.affine'
      ? ['a', 'b']
      : template === 'generated.c.interval'
        ? ['lower', 'upper', 'inside', 'outside']
        : ['a', 'b', 'divisor'],
  );
  for (const [key, value] of Object.entries(parameters))
    practiceAssert((key === 'upper' && small && value === null) || integer(value));
}
export async function decodePracticeResponse(
  buffer: ArrayBuffer,
  request: PracticeRequest,
  buildId: string,
  guard: () => void = () => {},
  problem?: GeneratedProblem,
): Promise<PracticeResponse> {
  guard();
  practiceAssert(buffer.byteLength > 0 && buffer.byteLength <= 16777216);
  const textBody = new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    lexical = precheckJson(textBody);
  let checkpoint = performance.now();
  for (let next = lexical.next(); !next.done; next = lexical.next()) {
    guard();
    if (performance.now() - checkpoint >= 6) {
      await new Promise<void>((r) => setTimeout(r, 0));
      guard();
      checkpoint = performance.now();
    }
  }
  const response = JSON.parse(textBody) as PracticeResponse;
  const fields = [
    'generatorVersion',
    'producer',
    'buildId',
    'requestId',
    'operation',
    'stats',
    request.operation === 'generate' ? 'problem' : 'assessment',
  ];
  keys(response, fields);
  keys(response.stats, ['fuelUsed', 'steps', 'outputBytes']);
  practiceAssert(
    response.generatorVersion === '1.0.0' &&
      response.producer === 'rust' &&
      response.buildId === buildId &&
      response.requestId === request.requestId &&
      response.operation === request.operation &&
      safe(response.stats.fuelUsed, 1000000) &&
      safe(response.stats.steps, 20000) &&
      safe(response.stats.outputBytes, 16384),
  );
  if (response.operation === 'generate') {
    practiceAssert(request.operation === 'generate');
    checkProblem(response.problem, request);
    guard();
    return response;
  }
  practiceAssert(request.operation !== 'generate' && problem);
  const a = response.assessment;
  keys(a, [
    'problemId',
    'attemptId',
    'sourceRevision',
    'complete',
    'verdict',
    'totalCases',
    'checkedCases',
    'passedCases',
    'results',
    'replay',
  ]);
  practiceAssert(
    a.problemId === request.problemId &&
      a.problemId === problem.problemId &&
      a.attemptId === request.attemptId &&
      a.sourceRevision === request.sourceRevision &&
      typeof a.complete === 'boolean' &&
      ['passed', 'unmet', 'rejected', 'limited'].includes(a.verdict) &&
      a.totalCases === problem.cases.length &&
      safe(a.checkedCases, 25) &&
      a.checkedCases > 0 &&
      safe(a.passedCases, a.checkedCases) &&
      Array.isArray(a.results) &&
      a.results.length === a.checkedCases,
  );
  const input = request.operation === 'preview' ? Number(request.inputText?.trim()) : null;
  a.results.forEach((r, i) => {
    keys(r, ['caseId', 'inputText', 'expectedStdout', 'actualStdout', 'status', 'code']);
    const c = problem.cases[request.operation === 'preview' ? input! - problem.inputMin : i];
    practiceAssert(
      c &&
        r.caseId === c.caseId &&
        r.inputText === c.inputText &&
        r.expectedStdout === c.expectedStdout &&
        text(r.actualStdout, 16384) &&
        ['passed', 'wrong-answer', 'program-error', 'resource-limit'].includes(r.status) &&
        (r.code === null || /^E_[A-Z_]+$/.test(r.code)),
    );
    if (r.status === 'passed')
      practiceAssert(r.actualStdout === r.expectedStdout && r.code === null);
  });
  practiceAssert(a.passedCases === a.results.filter((r) => r.status === 'passed').length);
  if (request.operation === 'preview') practiceAssert(a.checkedCases === 1 && !a.complete);
  if (a.complete)
    practiceAssert(
      request.operation === 'grade' &&
        a.checkedCases === a.totalCases &&
        a.results.every((r) => r.status === 'passed' || r.status === 'wrong-answer'),
    );
  if (a.verdict === 'passed')
    practiceAssert(
      a.passedCases === a.checkedCases && (request.operation === 'preview' || a.complete),
    );
  if (a.verdict === 'unmet')
    practiceAssert(
      a.passedCases < a.checkedCases &&
        a.results.every((r) => r.status === 'passed' || r.status === 'wrong-answer'),
    );
  if (a.verdict === 'rejected' || a.verdict === 'limited')
    practiceAssert(
      !a.complete &&
        a.results.at(-1)!.status === (a.verdict === 'limited' ? 'resource-limit' : 'program-error'),
    );
  const replay = a.replay;
  keys(replay, ['caseId', 'inputText', 'request', 'result']);
  const expected = a.results.find((r) => r.status !== 'passed') ?? a.results.at(-1)!;
  practiceAssert(replay.caseId === expected.caseId && replay.inputText === expected.inputText);
  encodeAdvancedRequest(replay.request);
  practiceAssert(
    replay.request.language === 'c' &&
      replay.request.source === request.source &&
      replay.request.sourceRevision === request.sourceRevision &&
      replay.request.runId === `${request.attemptId}.case.${a.results.indexOf(expected)}` &&
      replay.request.input.kind === 'integers' &&
      replay.request.input.values.length === 1 &&
      String(replay.request.input.values[0]) === expected.inputText,
  );
  const bytes = new TextEncoder().encode(JSON.stringify(replay.result));
  replay.result = await decodeAdvancedResult(bytes.buffer, replay.request, buildId, guard);
  const actual =
    replay.result.trace?.steps
      .flatMap((s) => s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])))
      .join('') ?? '';
  practiceAssert(actual === expected.actualStdout);
  if (expected.status === 'passed' || expected.status === 'wrong-answer')
    practiceAssert(
      replay.result.terminal.status === 'completed' && replay.result.terminal.returnValue === 0,
    );
  else
    practiceAssert(
      replay.result.terminal.status ===
        (expected.status === 'resource-limit' ? 'limited' : 'error') ||
        (expected.status === 'program-error' &&
          replay.result.terminal.status === 'completed' &&
          replay.result.terminal.returnValue !== 0),
    );
  guard();
  return response;
}
