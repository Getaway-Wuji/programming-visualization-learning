import { useMemo } from 'react';
import { sourceLines } from './breakpoints';
import './debug.css';

export function DebugSource({
  source,
  byteRange,
  breakpoints,
  visitedLines,
  ready,
  onToggle,
}: {
  source: string;
  byteRange: { start: number; end: number } | null;
  breakpoints: number[];
  visitedLines: number[];
  ready: boolean;
  onToggle: (line: number) => void;
}) {
  const lines = useMemo(() => sourceLines(source), [source]);
  const bytes = new TextEncoder().encode(source);
  const start = byteRange ? new TextDecoder().decode(bytes.slice(0, byteRange.start)).length : 0;
  const end = byteRange ? new TextDecoder().decode(bytes.slice(0, byteRange.end)).length : 0;
  return (
    <div className="debug-code-scroll" tabIndex={0} aria-label="源码与行断点">
      <div className="debug-code-grid">
        <div className="debug-gutter" role="group" aria-label="行断点">
          {lines.map((line) => {
            const marked = breakpoints.includes(line.number);
            const unvisited = ready && !visitedLines.includes(line.number);
            return (
              <button
                key={line.number}
                type="button"
                className="debug-line"
                data-testid="debug-line"
                data-line={line.number}
                aria-label={`${marked ? '移除' : '设置'}第 ${line.number} 行断点`}
                aria-pressed={marked}
                disabled={!line.text.trim()}
                title={
                  unvisited
                    ? '本次轨迹没有该行的停靠步骤；断点不会移到其他行'
                    : '点击或按空格切换行断点'
                }
                onClick={() => onToggle(line.number)}
              >
                <span aria-hidden="true">{marked ? '●' : '·'}</span> {line.number}
              </button>
            );
          })}
        </div>
        <pre tabIndex={0} aria-label="本次执行的只读源码">
          {byteRange ? (
            <>
              {source.slice(0, start)}
              <mark
                data-testid="memory-source-highlight"
                data-byte-start={byteRange.start}
                data-byte-end={byteRange.end}
              >
                {source.slice(start, end)}
              </mark>
              {source.slice(end)}
            </>
          ) : (
            source
          )}
        </pre>
      </div>
    </div>
  );
}
