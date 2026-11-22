import type { C6CourseExercise } from '../content/c6-course-types';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import type { DisplayDiagnostic } from '../diagnostics/presentation';
import type { C6JudgeResult, C6Result } from '../engine/c6-types';
import type { ByteRange } from '../engine/protocol';
import { createSourceIndex } from '../player/source-location';
import { outputsMatch, recordedOutput } from '../practice/output-policy';

export function sourceDiagnostic(code: string, byteRange: ByteRange | null): DisplayDiagnostic {
  return {
    code,
    ...(byteRange && {
      location: { kind: 'source', nodeId: 'unmapped', byteRange, edge: 'whole' },
    }),
  };
}

const technicalMessages: Readonly<Record<string, string>> = {
  E_LEX_INVALID: 'invalid character or literal',
  E_PARSE_INVALID: 'invalid syntax',
  E_NAME_INVALID: 'expected a valid identifier',
  E_DUPLICATE: 'redeclaration in the same scope',
  E_UNDECLARED: 'use of undeclared identifier',
  E_TYPE_INVALID: 'incompatible type',
  E_ARGUMENTS: 'incorrect number of arguments',
  E_FORMAT_UNSUPPORTED: 'unsupported format string',
  E_DIV_ZERO: 'division or remainder by zero',
  E_UNINITIALIZED: 'read of uninitialized value',
  E_BOUNDS: 'index is out of bounds',
};

export function terminalDiagnostics(
  terminal: C6Result['terminal'],
  source: string,
): DisplayDiagnostic[] {
  const { code, byteRange, syntax } = terminal;
  if (!code) return [];
  const index = createSourceIndex(source);
  const fragment = (bytes: ByteRange | null) => {
    const range = bytes && index.range(bytes)?.utf16Range;
    if (!range || range.start === range.end) return '';
    const text = source.slice(range.start, range.end);
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
  };
  if (syntax) {
    const expected =
      syntax.expected === 'expression' ? 'an expression' : JSON.stringify(syntax.expected);
    const found = fragment(syntax.found);
    return [
      {
        ...sourceDiagnostic(code, byteRange),
        rawMessage: `expected ${expected}${found ? ` before ${found}` : ' at end of input'}`,
        stage: 'parse',
        ...(syntax.expected === ';' ? {} : { details: { expected: syntax.expected } }),
      },
    ];
  }
  const message = technicalMessages[code] ?? code.slice(2).toLowerCase().replaceAll('_', ' ');
  const marked = fragment(byteRange);
  return [
    {
      ...sourceDiagnostic(code, byteRange),
      rawMessage: marked ? `${message} at ${marked}` : message,
    },
  ];
}

export function PracticeFeedback({
  result,
  exercise,
  failedCaseKey,
  source,
  onLocateSource,
}: {
  result: C6Result | C6JudgeResult;
  exercise: C6CourseExercise;
  failedCaseKey: string | null;
  source: string;
  onLocateSource: (range: ByteRange) => void;
}) {
  const failure =
    'cases' in result
      ? (result.cases.find(
          ({ packet }) =>
            packet.terminal.status === 'limited' || packet.terminal.status === 'cancelled',
        ) ?? result.cases.find(({ caseKey }) => caseKey === failedCaseKey))
      : undefined;
  const test = exercise.tests.find((row) => row.caseKey === failure?.caseKey);
  const packet = 'cases' in result ? failure?.packet : result;
  const terminal = packet?.terminal;
  const stopped = terminal?.status === 'limited' || terminal?.status === 'cancelled';
  const heading = stopped
    ? '判题未完成'
    : terminal?.code === 'E_UNSUPPORTED_SYNTAX' && !failure
      ? '教学解释器暂不支持这段语法'
      : failure
        ? '运行错误'
        : '编译错误';

  if (terminal?.code)
    return (
      <section className="c6-practice-feedback" aria-label="判题详情">
        <h3>{heading}</h3>
        {test && (
          <p>
            第 {exercise.tests.indexOf(test) + 1} 组输入{' '}
            <code>{test.stdin.trim() || '（空）'}</code>
          </p>
        )}
        <DiagnosticPanel
          diagnostics={terminalDiagnostics(terminal, source)}
          source={{ text: source, language: 'c' }}
          onLocateSource={onLocateSource}
        />
      </section>
    );

  if (!failure || !test) return null;
  const actual = recordedOutput(failure.packet.trace);
  const outputMatches = outputsMatch(actual, test.expectedStdout);
  const formatMismatch =
    !outputMatches && actual.replace(/\s/g, '') === test.expectedStdout.replace(/\s/g, '');
  return (
    <section className="c6-practice-feedback" aria-label="判题详情">
      <h3>
        {outputMatches
          ? failure.returnMatches
            ? '未满足本题要求'
            : '返回值错误'
          : formatMismatch
            ? '输出格式不符'
            : '输出不符'}
      </h3>
      <p>第 {exercise.tests.indexOf(test) + 1} 组输入</p>
      <pre className="sample-source">{test.stdin || '（空）'}</pre>
      {!outputMatches && (
        <div className="c6-practice-outputs">
          <div>
            <h4>预期输出</h4>
            <pre className="sample-source">{test.expectedStdout || '（空）'}</pre>
          </div>
          <div>
            <h4>实际输出</h4>
            <pre className="sample-source">{actual || '（无输出）'}</pre>
          </div>
        </div>
      )}
      {!failure.returnMatches && (
        <p>
          本题要求返回 <code>{test.expectedReturnCode}</code>，实际返回{' '}
          <code>{String(terminal?.returnValue)}</code>。
        </p>
      )}
      {outputMatches && failure.returnMatches && <p>{exercise.nodeSpecificRequirement}</p>}
    </section>
  );
}
