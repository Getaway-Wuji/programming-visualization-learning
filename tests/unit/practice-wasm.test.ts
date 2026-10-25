import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodePractice,
  exerciseCatalog,
  type CoursePractice,
  type ExerciseCatalog,
} from '../../web/src/content/practice';
import { practiceRelease } from '../../web/src/content/practice-release.generated';
import type { ExerciseTest } from '../../web/src/content/types';
import { decodeResult, encodeRequest, type ExecuteResult } from '../../web/src/engine/protocol';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { initSync, execute_request, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { defaultAnswer, generateAnswer } from '../../web/src/practice/answer';
import {
  caseSummary,
  exerciseRequest,
  submissionMet,
  type CaseSummary,
} from '../../web/src/practice/submission';

const ids = [
  'exercise.c.echo',
  'exercise.c.two-x-plus-three',
  'exercise.c.nonnegative',
  'exercise.c.two-loop-sums',
  'exercise.c.increment-at-index',
  'exercise.c.array-sum',
] as const;
const correct: Record<string, Record<string, string>> = {
  'exercise.c.echo': { outputSource: 'x', constant: '0', inputStyle: 'direct' },
  'exercise.c.two-x-plus-three': {
    multiplier: '2',
    constant: '3',
    operation: '+',
    operandOrder: 'multiplier-first',
  },
  'exercise.c.nonnegative': { comparison: '>=', thenValue: '1', elseValue: '0' },
  'exercise.c.two-loop-sums': {
    whileInitial: '0',
    whileStart: '1',
    whileBoundary: '<=',
    whileOperation: '+',
    forInitial: '0',
    forStart: '1',
    forBoundary: '<=',
    forOperation: '+',
    direction: 'ascending',
  },
  'exercise.c.increment-at-index': { increment: '1' },
  'exercise.c.array-sum': {
    initial: '0',
    operation: '+',
    inputStyle: 'direct',
    direction: 'ascending',
  },
};
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let course: CoursePractice;
const alternatives: { id: string; changes: Record<string, string> }[] = [
  { id: ids[0], changes: { inputStyle: 'copy-zero' } },
  { id: ids[1], changes: { operandOrder: 'x-first', operation: '-', constant: '-3' } },
  { id: ids[3], changes: { direction: 'descending' } },
  { id: ids[5], changes: { inputStyle: 'copy-zero', direction: 'descending' } },
];

function stdout(result: ExecuteResult): string {
  return result
    .trace!.steps.flatMap((step) =>
      step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
    )
    .join('');
}
function prepare(catalog: ExerciseCatalog, test: ExerciseTest): PreparedSource {
  const input = Object.fromEntries(
    Object.keys(test.input)
      .sort()
      .map((key) => [key, test.input[key]]),
  );
  const prepared = prepare_input(
    JSON.stringify(catalog),
    encoder.encode(JSON.stringify(input)),
    1000,
  );
  return (JSON.parse(decoder.decode(prepared)) as { source: PreparedSource }).source;
}
interface SubmissionEvidence {
  summaries: CaseSummary[];
  results: ExecuteResult[];
  sources: PreparedSource[];
}
async function runAnswer(
  catalog: ExerciseCatalog,
  answer: Record<string, string>,
  stopAtFirstUnmet = false,
): Promise<SubmissionEvidence> {
  const catalogBefore = JSON.stringify(catalog);
  const contextId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const summaries: CaseSummary[] = [];
  const results: ExecuteResult[] = [];
  const sources: PreparedSource[] = [];
  for (const [index, test] of catalog.subject.tests.entries()) {
    const prepared = prepare(catalog, test);
    const source = generateAnswer(catalog.subject.id, prepared, answer);
    expect(source.bindingMap).toEqual(prepared.bindingMap);
    const request = exerciseRequest(
      catalog,
      source,
      {
        contextId,
        contextRevision: 1,
        sourceRevision: index + 1,
      },
      submissionId,
      test,
    );
    const bytes = execute_request(
      encodeRequest(request),
      catalogBefore,
      engineBuild.wasmSha256,
      1000,
    ).slice();
    const result = await decodeResult(bytes.buffer, request);
    expect(result.producer).toBe('rust');
    expect(result.identity).toEqual(request.identity);
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.trace?.completeness).toBe('complete');
    expect(result.judgeResult?.profileRef).toEqual(catalog.subject.judgeRef);
    expect(result.judgeResult?.caseKey).toBe(test.caseKey);
    expect(result.resolvedBindings).toHaveLength(catalog.program.bindings.length);
    const summary = caseSummary(request, result);
    summaries.push(summary);
    results.push(result);
    sources.push(source);
    if (stopAtFirstUnmet && !summary.met) break;
  }
  expect(JSON.stringify(catalog)).toBe(catalogBefore);
  return { summaries, results, sources };
}
function assertAllChecks(catalog: ExerciseCatalog, evidence: SubmissionEvidence) {
  expect(evidence.summaries).toHaveLength(catalog.subject.tests.length);
  const expectedChecks = [
    'input-bindings',
    'stdout-exact',
    'exit-zero',
    'teaching-target',
    ...(catalog.judgeProfile.rule === 'while-for-accumulations'
      ? ['while-accumulation', 'for-accumulation']
      : []),
  ].sort();
  for (const [index, result] of evidence.results.entries()) {
    expect(stdout(result)).toBe(catalog.subject.tests[index].expectedStdout);
    expect(result.terminal.exitCode).toBe(catalog.subject.tests[index].expectedExitCode);
    expect(result.judgeResult?.status).toBe('met');
    expect(result.judgeResult!.checks.map((check) => check.key).sort()).toEqual(expectedChecks);
    expect(
      result.judgeResult!.checks.every(
        (check) => check.status === 'met' && check.diagnosticCodes.length === 0,
      ),
    ).toBe(true);
    if (catalog.subject.tests[index].expectedArray) {
      expect(result.judgeResult!.observations).toHaveLength(1);
      expect(result.judgeResult!.observations[0]).toMatchObject({
        kind: 'array-before-destroy',
        bindingKey: 'param.values',
        values: catalog.subject.tests[index].expectedArray,
      });
    }
  }
  expect(submissionMet(catalog, evidence.summaries)).toBe(true);
  expect(new Set(evidence.summaries.map((entry) => entry.identity.submissionId)).size).toBe(1);
  expect(new Set(evidence.summaries.map((entry) => entry.identity.runId)).size).toBe(
    catalog.subject.tests.length,
  );
  expect(evidence.summaries.map((entry) => entry.identity.sourceRevision)).toEqual(
    catalog.subject.tests.map((_, index) => index + 1),
  );
}

describe('09.3 finite answer UI generation through actual Rust/WASM and the production decoder', () => {
  beforeAll(async () => {
    course = await decodePractice(
      new Uint8Array(
        readFileSync(new URL(`../../web/public/${practiceRelease.file}`, import.meta.url)),
      ),
    );
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
  });

  // These are semantic/identity integration checks with an explicit per-call
  // WASM budget. They do not claim the browser's whole-submission 1000 ms gate;
  // browser lifecycle tests exercise that deadline and its post-render guard.
  it.each(ids)('accepts every frozen group for a constructed answer: %s', async (id) => {
    const catalog = exerciseCatalog(course, id);
    const evidence = await runAnswer(catalog, correct[id]);
    assertAllChecks(catalog, evidence);
    if (id === 'exercise.c.nonnegative') {
      const visited = evidence.summaries.flatMap((entry) =>
        entry.coverage.filter((coverage) => coverage.visits > 0),
      );
      expect(new Set(visited.map((entry) => entry.siteKey))).toEqual(new Set(['answer.if']));
      expect(new Set(visited.map((entry) => entry.branch))).toEqual(new Set(['then', 'else']));
      expect(
        evidence.sources.every((source) =>
          source.blockMap.some((map) => map.blockId === 'answer.if'),
        ),
      ).toBe(true);
    }
  });

  it.each(ids)('rejects the default unfinished answer using real checks: %s', async (id) => {
    const catalog = exerciseCatalog(course, id);
    const evidence = await runAnswer(catalog, defaultAnswer(id), true);
    expect(evidence.summaries.length).toBeGreaterThan(0);
    expect(evidence.summaries.at(-1)?.met).toBe(false);
    expect(submissionMet(catalog, evidence.summaries)).toBe(false);
    const last = evidence.results.at(-1)!;
    expect(last.judgeResult?.status).toBe('unmet');
    expect(last.judgeResult?.checks.some((check) => check.status !== 'met')).toBe(true);
    // The failure is derived from actual output or Rust's teaching checks,
    // rather than from a UI option name or from source-text equality.
    const test = catalog.subject.tests[evidence.results.length - 1];
    expect(
      stdout(last) !== test.expectedStdout ||
        last.judgeResult!.checks.some(
          (check) => check.key === 'teaching-target' && check.status !== 'met',
        ),
    ).toBe(true);
  });

  it.each(alternatives)(
    'accepts a different finite expression/traversal structure: $id',
    async ({ id, changes }) => {
      const catalog = exerciseCatalog(course, id);
      const evidence = await runAnswer(catalog, { ...correct[id], ...changes });
      assertAllChecks(catalog, evidence);
      expect(evidence.sources[0].text).not.toBe(
        generateAnswer(id, prepare(catalog, catalog.subject.tests[0]), correct[id]).text,
      );
    },
  );
});
