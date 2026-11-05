import profiles from '../../../engine/c6/resources/judges-1.0.0.json' with { type: 'json' };
import type { C6JudgeResult } from '../engine/c6-types';
import { outputsMatch, recordedOutput } from '../practice/output-policy';

/** Apply only after validating the original Rust packet and exact-output flags.
 * The raw packet stays unchanged; this is the product's OJ output policy. */
export function c6OutputVerdict(result: C6JudgeResult) {
  const profile = profiles.profiles.find(
    (p) => p.ref.id === result.profileRef.id && p.ref.version === result.profileRef.version,
  );
  const failed = result.cases.find((row, index) => {
    const expected = profile?.testDomain[index];
    return (
      !expected ||
      expected.caseKey !== row.caseKey ||
      !row.returnMatches ||
      !row.observationMatches ||
      !row.packet.trace ||
      row.packet.trace.completeness !== 'complete' ||
      row.packet.terminal.status !== 'completed' ||
      row.packet.terminal.returnValue !== 0 ||
      !outputsMatch(recordedOutput(row.packet.trace), expected.expectedStdout)
    );
  });
  const status =
    result.status === 'incomplete'
      ? ('incomplete' as const)
      : profile && result.cases.length === 4 && !failed
        ? ('passed' as const)
        : ('failed' as const);
  const expected = profile?.testDomain.find((row) => row.caseKey === failed?.caseKey);
  return {
    status,
    failedCaseKey: failed?.caseKey ?? null,
    failure: !failed
      ? null
      : !failed.returnMatches
        ? ('program-error' as const)
        : !expected || !outputsMatch(recordedOutput(failed.packet.trace), expected.expectedStdout)
          ? ('wrong-answer' as const)
          : ('teaching-goal-unmet' as const),
  };
}
