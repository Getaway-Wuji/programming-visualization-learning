import { createSourceIndex } from '../player/source-location';
export function SortSource({
  source,
  range,
}: {
  source: string;
  range: { start: number; end: number } | null;
}) {
  const location = range ? createSourceIndex(source).range(range) : null;
  return (
    <section className="sort-source">
      <h3>本侧实际C++源码</h3>
      <p className="muted">
        只替换长度n，原整数序列由cin读入。
        {location ? `当前第${location.start.line}行。` : '尚无对应步骤。'}
      </p>
      <pre tabIndex={0} aria-label="本侧实际C++源码" data-testid="pair-source">
        {location ? (
          <>
            {source.slice(0, location.utf16Range.start)}
            <mark
              data-testid="pair-source-highlight"
              data-byte-start={location.byteRange.start}
              data-byte-end={location.byteRange.end}
            >
              {source.slice(location.utf16Range.start, location.utf16Range.end)}
            </mark>
            {source.slice(location.utf16Range.end)}
          </>
        ) : (
          source
        )}
      </pre>
      <details>
        <summary>复制本侧完整源码</summary>
        <textarea readOnly aria-label="本侧可复制的完整C++源码" value={source} rows={8} />
      </details>
    </section>
  );
}
