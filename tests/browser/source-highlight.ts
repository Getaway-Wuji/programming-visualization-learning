import type { ByteRange } from '../../web/src/engine/protocol';

/** The public viewer paints one source line; exact multi-line execution
 * locations remain in the independently checked packet and location caption. */
export function expectedSourceLine(source: string, range: ByteRange | null): ByteRange | null {
  if (!range) return null;
  const bytes = Buffer.from(source);
  const before = bytes.subarray(0, range.start);
  const start = Math.max(before.lastIndexOf(10), before.lastIndexOf(13)) + 1;
  const ends = [bytes.indexOf(10, range.start), bytes.indexOf(13, range.start)].filter(
    (n) => n >= 0,
  );
  const end = ends.length ? Math.min(...ends) : bytes.length;
  const text = bytes.subarray(start, end).toString('utf8').trim();
  const selected = bytes.subarray(range.start, range.end).toString('utf8').trim();
  return !text || /^[{};\s]+$/.test(text) || selected.startsWith('{') || selected === '}'
    ? null
    : { start, end };
}
