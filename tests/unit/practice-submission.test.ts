import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodePractice,
  exerciseCatalog,
  type CoursePractice,
} from '../../web/src/content/practice';
import {
  caseSummary,
  exerciseRequest,
  submissionMet,
  type CaseSummary,
} from '../../web/src/practice/submission';
import { makeAdapterResult, type ExecuteResult } from '../../web/src/engine/protocol';
const bytes = readFileSync('web/public/content/practice/course-practice-1.0.0.json');
const content = JSON.parse(bytes.toString()) as CoursePractice;
const catalog = (index = 0) => exerciseCatalog(content, content.exercises[index].id);
// Explicit synthetic summary models test the aggregation boundary, never C execution.
function summaries(index = 0): CaseSummary[] {
  return catalog(index).subject.tests.map((test, position) => ({
    identity: {
      contextId: 'context',
      contextRevision: 1,
      sourceRevision: position + 1,
      submissionId: 'submission',
      runId: `run-${position}`,
      testCaseKey: test.caseKey,
    },
    caseKey: test.caseKey,
    met: true,
    terminal: 'completed',
    checks: [],
    coverage: [],
  }));
}
describe('09.3 exact practice release and summary aggregation boundary', () => {
  it('loads only exact immutable practice bytes without granting learning events', async () => {
    const release = await decodePractice(bytes);
    expect(release.exercises).toHaveLength(6);
    expect(release.exercises.map((exercise) => exercise.tests.length)).toEqual([3, 3, 3, 4, 5, 6]);
    expect(release.exercises.reduce((sum, exercise) => sum + exercise.tests.length, 0)).toBe(24);
    expect(Object.isFrozen(release.exercises[0].tests)).toBe(true);
    expect('catalog' in release).toBe(false);
    expect(release.packageRef.version).toBe('1.0.1');
  });
  it.each(['changed', 'truncated', 'duplicate'])(
    'rejects %s practice bytes before parsing',
    async (kind) => {
      const altered =
        kind === 'truncated'
          ? bytes.subarray(1)
          : kind === 'duplicate'
            ? Buffer.from('{"x":1,"x":2}')
            : Buffer.from(bytes);
      if (kind === 'changed') altered[0] = 32;
      await expect(decodePractice(altered)).rejects.toThrow('PRACTICE_INTEGRITY');
    },
  );
  it('builds requests exclusively from the frozen selected test and shared submission identity', () => {
    const c = catalog(4);
    const test = c.subject.tests[0];
    const request = exerciseRequest(
      c,
      { text: 'int main(void) { return 0; }', bindingMap: [], blockMap: [] },
      { contextId: 'context', contextRevision: 2, sourceRevision: 4 },
      'submission',
      test,
    );
    expect(request.input.values).toEqual(test.input);
    expect(request.judge).toEqual({
      profileRef: c.subject.judgeRef,
      rule: c.judgeProfile.rule,
      expectedStdout: test.expectedStdout,
      expectedExitCode: 0,
      expectedArray: test.expectedArray,
    });
    expect(request.identity).toMatchObject({
      submissionId: 'submission',
      testCaseKey: test.caseKey,
      sourceRevision: 4,
    });
  });
  it('requires the exact ordered complete case set, unique runs and increasing source versions', () => {
    const rows = summaries();
    expect(submissionMet(catalog(), rows)).toBe(true);
    expect(submissionMet(catalog(), rows.slice(1))).toBe(false);
    for (const alter of [
      (r: CaseSummary[]) => r.reverse(),
      (r: CaseSummary[]) => {
        r[1].identity.runId = r[0].identity.runId;
      },
      (r: CaseSummary[]) => {
        r[1].identity.sourceRevision = 1;
      },
      (r: CaseSummary[]) => {
        r[1].identity.submissionId = 'different';
      },
      (r: CaseSummary[]) => {
        r[1].identity.contextRevision = 2;
      },
      (r: CaseSummary[]) => {
        r[1].met = false;
      },
    ]) {
      const changed = structuredClone(rows);
      alter(changed);
      expect(submissionMet(catalog(), changed)).toBe(false);
    }
  });
  it('aggregates EX03 coverage by stable siteKey, rejecting different sites, zero visits and node-ID guesses', () => {
    const rows = summaries(2);
    const coverage = (siteKey: string, branch: 'then' | 'else', visits = 1) => ({
      siteKey,
      nodeId: 'n99',
      branch,
      visits,
    });
    rows[0].coverage = [coverage('answer.if', 'then')];
    rows[1].coverage = [coverage('other.if', 'else')];
    expect(submissionMet(catalog(2), rows)).toBe(false);
    rows[1].coverage = [coverage('answer.if', 'else', 0)];
    expect(submissionMet(catalog(2), rows)).toBe(false);
    rows[1].coverage = [{ ...coverage('answer.if', 'else'), nodeId: 'n123' }];
    expect(submissionMet(catalog(2), rows)).toBe(true);
  });
  it('never treats an adapter result, missing check or foreign identity as a met case', () => {
    const c = catalog();
    const request = exerciseRequest(
      c,
      { text: 'int main(void) { return 0; }', bindingMap: [], blockMap: [] },
      { contextId: 'context', contextRevision: 1, sourceRevision: 1 },
      'submission',
      c.subject.tests[0],
    );
    const adapter = makeAdapterResult(request, 'resource-limit', 'E_DEADLINE');
    expect(caseSummary(request, adapter).met).toBe(false);
    const synthetic: ExecuteResult = {
      ...adapter,
      producer: 'rust',
      terminal: { ...adapter.terminal, status: 'completed', exitCode: 0, diagnostics: [] },
      judgeResult: {
        profileRef: c.subject.judgeRef,
        caseKey: c.subject.tests[0].caseKey,
        status: 'met',
        checks: ['input-bindings', 'stdout-exact', 'exit-zero', 'teaching-target'].map((key) => ({
          key,
          status: 'met',
          nodeIds: [],
          stepSeqs: [],
          diagnosticCodes: [],
        })),
        coverage: [],
        observations: [],
      },
    };
    expect(caseSummary(request, synthetic).met).toBe(true);
    const missing = structuredClone(synthetic);
    missing.judgeResult!.checks.pop();
    expect(caseSummary(request, missing).met).toBe(false);
    const foreign = structuredClone(synthetic);
    foreign.identity.runId = 'foreign';
    expect(caseSummary(request, foreign).met).toBe(false);
  });
});
