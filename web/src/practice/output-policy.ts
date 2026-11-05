/** Preserve data, leading/internal spaces and internal line breaks. Only line-end
 * blanks and final line breaks are insignificant in practice submissions. */
export function normalizedOutput(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\r]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}
export function outputsMatch(actual: string, expected: string): boolean {
  return normalizedOutput(actual) === normalizedOutput(expected);
}
export function recordedOutput(
  trace: {
    initialState: { output: string };
    steps: readonly { changes: readonly { op: string; append?: string }[] }[];
  } | null,
): string {
  return (
    (trace?.initialState.output ?? '') +
    (trace?.steps
      .flatMap((step) =>
        step.changes.flatMap((change) =>
          change.op === 'output' && typeof change.append === 'string' ? [change.append] : [],
        ),
      )
      .join('') ?? '')
  );
}
