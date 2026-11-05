import { Fragment } from 'react';
import { createSourceIndex } from '../player/source-location';
import type { ByteRange } from '../engine/protocol';

/** Display coordinates only: compound-node ranges never paint an entire body. */
export function stepLineRange(source: string, range: ByteRange | null) {
  const position = range ? createSourceIndex(source).range(range) : null;
  if (!position) return null;
  const before = source.slice(0, position.utf16Range.start);
  const start = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
  const newline = source.slice(position.utf16Range.start).search(/[\r\n]/);
  const end = newline < 0 ? source.length : position.utf16Range.start + newline;
  const line = source.slice(start, end).trim();
  const selected = source.slice(position.utf16Range.start, position.utf16Range.end).trim();
  if (!line || /^[{};\s]+$/.test(line) || selected.startsWith('{') || selected === '}') return null;
  const encoder = new TextEncoder();
  return createSourceIndex(source).range({
    start: encoder.encode(source.slice(0, start)).length,
    end: encoder.encode(source.slice(0, end)).length,
  });
}

export function HighlightedCode({
  source,
  range,
  testId = 'memory-source-highlight',
}: {
  source: string;
  range: ByteRange | null;
  testId?: string;
}) {
  const active = stepLineRange(source, range);
  let offset = 0;
  return source.split(/(\r\n|\r|\n)/).map((part, i) => {
    const start = offset;
    offset += part.length;
    if (/^(\r\n|\r|\n)$/.test(part)) return <Fragment key={i}>{part}</Fragment>;
    return active && start === active.utf16Range.start ? (
      <mark
        className="code-line-highlight"
        key={i}
        data-testid={testId}
        data-byte-start={range?.start}
        data-byte-end={range?.end}
      >
        {part || ' '}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}
