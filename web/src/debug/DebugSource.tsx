import { useEffect, useMemo, useRef } from 'react';
import { sourceLines } from './breakpoints';
import './debug.css';
import { HighlightedCode } from '../components/HighlightedCode';

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
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const mark = box?.querySelector('mark');
    if (!box || !mark) return;
    const viewport = box.getBoundingClientRect(),
      target = mark.getBoundingClientRect();
    if (target.top < viewport.top) box.scrollTop += target.top - viewport.top - 12;
    else if (target.bottom > viewport.bottom) box.scrollTop += target.bottom - viewport.bottom + 12;
  }, [byteRange?.start, byteRange?.end, source]);
  return (
    <div ref={scroller} className="debug-code-scroll" tabIndex={0} aria-label="源码与行断点">
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
          <HighlightedCode source={source} range={byteRange} />
        </pre>
      </div>
    </div>
  );
}
