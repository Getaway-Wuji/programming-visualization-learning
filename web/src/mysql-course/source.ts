/** Map UTF-8 protocol boundaries to textarea offsets, preserving CRLF and non-BMP text. */
export function mysqlSourcePositions(source: string) {
  const positions = new Map<number, { utf16Offset: number; line: number; column: number }>();
  let bytes = 0,
    utf16Offset = 0,
    line = 1,
    column = 1,
    afterCR = false;
  for (const scalar of source) {
    positions.set(bytes, { utf16Offset, line, column });
    const point = scalar.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    utf16Offset += scalar.length;
    if (scalar === '\r' || (scalar === '\n' && !afterCR)) {
      line++;
      column = 1;
    } else if (scalar !== '\n') column++;
    afterCR = scalar === '\r';
  }
  positions.set(bytes, { utf16Offset, line, column });
  return positions;
}
