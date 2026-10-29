import { caseRequest } from '../engine/execution-client';
import type { PreparedSource } from '../engine/execution-client';
import type {
  ExecuteRequest,
  ExecuteResult,
  ExecutionIdentity,
  JudgeResult,
} from '../engine/protocol';
import type { ExerciseTest } from '../content/types';
import type { ExerciseCatalog } from '../content/practice';
export interface CaseSummary {
  identity: ExecutionIdentity;
  caseKey: string;
  met: boolean;
  terminal: string;
  checks: { key: string; status: string; diagnosticCodes: string[] }[];
  coverage: JudgeResult['coverage'];
}
export function exerciseRequest(
  catalog: ExerciseCatalog,
  source: PreparedSource,
  context: Pick<ExecutionIdentity, 'contextId' | 'contextRevision' | 'sourceRevision'>,
  submissionId: string,
  test: ExerciseTest,
): ExecuteRequest {
  const request = caseRequest(catalog, source, context, { values: test.input, random: null });
  request.mode = 'exercise-test';
  if (
    ![
      'input-read-output',
      'multiply-add-output',
      'if-else-paths',
      'while-for-accumulations',
      'single-index-increment',
      'logical-array-accumulation',
    ].includes(catalog.judgeProfile.rule)
  ) {
    request.protocolVersion = '1.1.0';
    request.judgeVersion = '1.1.0';
  }
  request.identity.submissionId = submissionId;
  request.identity.testCaseKey = test.caseKey;
  request.judge = {
    profileRef: catalog.subject.judgeRef,
    rule: catalog.judgeProfile.rule,
    expectedStdout: test.expectedStdout,
    expectedExitCode: test.expectedExitCode,
    ...(test.expectedArray ? { expectedArray: [...test.expectedArray] } : {}),
  };
  return request;
}
export function caseSummary(request: ExecuteRequest, result: ExecuteResult): CaseSummary {
  const judge = result.judgeResult;
  const required = [
    'input-bindings',
    'stdout-exact',
    'exit-zero',
    'teaching-target',
    ...(request.judge?.rule === 'while-for-accumulations'
      ? ['while-accumulation', 'for-accumulation']
      : []),
  ];
  const checks =
    judge?.checks.map(({ key, status, diagnosticCodes }) => ({
      key,
      status,
      diagnosticCodes: [...diagnosticCodes],
    })) ?? [];
  const sameIdentity = Object.keys(request.identity).every(
    (key) =>
      request.identity[key as keyof ExecutionIdentity] ===
      result.identity[key as keyof ExecutionIdentity],
  );
  return {
    identity: { ...result.identity },
    caseKey: result.identity.testCaseKey ?? '',
    terminal: result.terminal.status,
    met:
      sameIdentity &&
      result.producer === 'rust' &&
      result.terminal.status === 'completed' &&
      result.terminal.exitCode === 0 &&
      judge?.status === 'met' &&
      judge.caseKey === request.identity.testCaseKey &&
      judge.profileRef.id === request.judge?.profileRef.id &&
      judge.profileRef.version === request.judge?.profileRef.version &&
      checks.length === required.length &&
      required.every(
        (key) => checks.filter((check) => check.key === key && check.status === 'met').length === 1,
      ),
    checks,
    coverage: judge?.coverage.map((entry) => ({ ...entry })) ?? [],
  };
}
/** Only identity/check/coverage aggregation. C evaluation remains exclusively Rust. */
export function submissionMet(
  catalog: ExerciseCatalog,
  summaries: readonly CaseSummary[],
): boolean {
  if (summaries.length !== catalog.subject.tests.length || !summaries.length) return false;
  const first = summaries[0].identity;
  const runs = new Set<string>();
  let revision = 0;
  for (let index = 0; index < summaries.length; index++) {
    const summary = summaries[index],
      id = summary.identity;
    if (
      !summary.met ||
      summary.caseKey !== catalog.subject.tests[index].caseKey ||
      id.testCaseKey !== summary.caseKey ||
      id.contextId !== first.contextId ||
      id.contextRevision !== first.contextRevision ||
      id.submissionId !== first.submissionId ||
      id.sourceRevision <= revision ||
      runs.has(id.runId)
    )
      return false;
    revision = id.sourceRevision;
    runs.add(id.runId);
  }
  const requiredSites: Partial<Record<import('../content/types').JudgeRule, number>> = {
    'if-else-paths': 1,
    'if-positive-normalize': 1,
    'nested-sign-branches': 2,
    'interval-membership': 1,
    'break-continue-odd-sum': 2,
  };
  const required = requiredSites[catalog.judgeProfile.rule];
  if (!required) return true;
  const sites = new Map<string, Set<string>>();
  for (const summary of summaries)
    for (const entry of summary.coverage)
      if (entry.visits > 0 && ['then', 'else'].includes(entry.branch)) {
        const branches = sites.get(entry.siteKey) ?? new Set<string>();
        branches.add(entry.branch);
        sites.set(entry.siteKey, branches);
      }
  return (
    [...sites.values()].filter((branches) => branches.has('then') && branches.has('else')).length >=
    required
  );
}
