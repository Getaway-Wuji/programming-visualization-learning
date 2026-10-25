import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ExecutionNode } from '../engine/protocol';
import type { PlayerSnapshot } from '../player/model';
import { createSourceIndex, mapSourceLocation, type SourceRange } from '../player/source-location';

type Highlight = { kind: 'step' | 'terminal'; range: SourceRange };

function synchronizeScroll(area: HTMLTextAreaElement, code: HTMLElement | null) {
  if (code) code.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
}

function mark(highlight: Highlight, children: ReactNode, key: string) {
  const { kind, range } = highlight;
  return (
    <mark
      key={key}
      className={`source-${kind}-mark${range.utf16Range.start === range.utf16Range.end ? ' source-point-mark' : ''}`}
      data-testid={`source-${kind}-highlight`}
      data-byte-start={range.byteRange.start}
      data-byte-end={range.byteRange.end}
      data-start={range.utf16Range.start}
      data-end={range.utf16Range.end}
    >
      {children}
    </mark>
  );
}

/** Split only at location boundaries. Both independent marks survive overlap. */
function highlightedSource(source: string, highlights: Highlight[]): ReactNode[] {
  const boundaries = [
    ...new Set([
      0,
      source.length,
      ...highlights.flatMap(({ range }) => [range.utf16Range.start, range.utf16Range.end]),
    ]),
  ].sort((a, b) => a - b);
  const pieces: ReactNode[] = [];
  for (let i = 0; i < boundaries.length; ++i) {
    const start = boundaries[i];
    for (const highlight of highlights) {
      if (highlight.range.utf16Range.start === start && highlight.range.utf16Range.end === start)
        pieces.push(mark(highlight, '', `${highlight.kind}-point-${start}`));
    }
    const end = boundaries[i + 1];
    if (end === undefined || start === end) continue;
    let piece: ReactNode = source.slice(start, end);
    for (const highlight of highlights) {
      if (highlight.range.utf16Range.start <= start && highlight.range.utf16Range.end >= end)
        piece = mark(highlight, piece, `${highlight.kind}-${start}`);
    }
    pieces.push(<span key={`segment-${start}`}>{piece}</span>);
  }
  return pieces;
}

export function SourcePanel({
  source,
  nodes,
  view,
}: {
  source: string;
  nodes: readonly ExecutionNode[];
  view: PlayerSnapshot;
}) {
  const index = useMemo(() => createSourceIndex(source), [source]);
  const current = mapSourceLocation(source, nodes, view.location, index);
  const tailFailure =
    view.terminal &&
    view.terminal.status !== 'completed' &&
    (view.cursor === null || view.cursor === view.length)
      ? view.terminal
      : null;
  const terminal = tailFailure
    ? mapSourceLocation(source, nodes, tailFailure.location, index)
    : null;
  const copyarea = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLElement>(null);
  const revealKind = terminal?.range ? 'terminal' : 'step';
  const revealStart = (terminal?.range ?? current.range)?.utf16Range.start ?? null;
  useEffect(() => {
    const area = copyarea.current;
    const code = overlay.current;
    if (!area || !code) return;
    const reveal = () => {
      const bounds = area.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      synchronizeScroll(area, code);
      if (revealStart === null) return;
      const highlighted = code.querySelector(`[data-testid="source-${revealKind}-highlight"]`);
      if (!highlighted) return;
      const target = highlighted.getBoundingClientRect();
      const style = getComputedStyle(area);
      const top = bounds.top + parseFloat(style.paddingTop);
      const bottom = bounds.bottom - parseFloat(style.paddingBottom);
      const left = bounds.left + parseFloat(style.paddingLeft);
      const right = bounds.right - parseFloat(style.paddingRight);
      const lineHeight = parseFloat(style.lineHeight);
      if (target.top < top) area.scrollTop += target.top - top;
      else if (target.top + lineHeight > bottom) area.scrollTop += target.top + lineHeight - bottom;
      if (target.left < left) area.scrollLeft += target.left - left;
      else if (target.right > right)
        area.scrollLeft += Math.min(target.right - right, target.left - left);
      synchronizeScroll(area, code);
    };
    const resize = new ResizeObserver(reveal);
    resize.observe(area);
    reveal();
    return () => resize.disconnect();
  }, [source, view.cursor, view.identity?.runId, revealKind, revealStart]);
  const highlights: Highlight[] = [];
  if (current.range) highlights.push({ kind: 'step', range: current.range });
  if (terminal?.range) highlights.push({ kind: 'terminal', range: terminal.range });
  return (
    <section
      className="workbench-panel code-pane"
      data-testid="code-panel"
      aria-label="执行代码区域"
    >
      <header className="panel-heading">
        <h3>本次执行的 C 代码</h3>
        <span className="badge badge-muted">只读</span>
      </header>
      <p className="source-position source-location" data-testid="source-location">
        {view.cursor !== null && view.cursor > 0 ? `刚完成第 ${view.cursor} 步：` : ''}
        {current.description}。
      </p>
      {terminal && (
        <p
          className="source-position source-terminal-location"
          data-testid="source-terminal-location"
        >
          末尾终止位置（失败动作未提交为步骤）：{terminal.description}。
        </p>
      )}
      <div className="source-view">
        <pre className="source-highlight" aria-hidden="true">
          <code className="source-highlight-text" ref={overlay}>
            {highlightedSource(source, highlights)}
          </code>
        </pre>
        <textarea
          ref={copyarea}
          className="source-copyarea"
          aria-label="当前执行的 C 代码"
          value={source}
          readOnly
          spellCheck={false}
          wrap="off"
          onScroll={(event) => synchronizeScroll(event.currentTarget, overlay.current)}
        />
      </div>
    </section>
  );
}
