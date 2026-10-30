import { useId } from 'react';
import type { ByteRange } from '../engine/protocol';
import { presentDiagnostic, type DiagnosticSource, type DisplayDiagnostic } from './presentation';
import './diagnostics.css';

export function DiagnosticPanel({
  diagnostics,
  source,
  onLocateSource,
  onLocateBlock,
}: {
  diagnostics: readonly DisplayDiagnostic[];
  source: DiagnosticSource;
  onLocateSource?: (range: ByteRange) => void;
  onLocateBlock?: (id: string) => void;
}) {
  const heading = useId();
  if (!diagnostics.length) return null;
  return (
    <section className="diagnostic-panel" aria-labelledby={heading} data-testid="diagnostic-panel">
      <h4 id={heading}>错误诊断</h4>
      <p className="diagnostic-caption">GCC 风格教学展示 · 错误来自当前检查或执行；未调用 GCC。</p>
      <ol className="diagnostic-list">
        {diagnostics.map((diagnostic, i) => {
          const view = presentDiagnostic(diagnostic, source);
          return (
            <li
              key={`${diagnostic.code}:${i}`}
              data-testid="diagnostic-item"
              data-code={diagnostic.code}
              data-stage={diagnostic.stage ?? 'unspecified'}
            >
              <p className="diagnostic-heading" role="alert">
                <code data-testid="diagnostic-gcc">{view.gcc}</code>
              </p>
              <p className="diagnostic-caption">
                {view.stage} · {view.origin} · 当前教学文件 {view.file}
              </p>
              {view.range && view.excerpt ? (
                <>
                  <pre className="diagnostic-excerpt" tabIndex={0} aria-label="诊断对应源码片段">
                    <code>
                      <span className="diagnostic-line-number">{view.range.start.line} | </span>
                      {view.excerpt.clippedStart && '…'}
                      {view.excerpt.before}
                      <mark data-testid="diagnostic-source-mark">{view.excerpt.marked || '▏'}</mark>
                      {view.excerpt.after}
                      {view.excerpt.clippedEnd && '…'}
                    </code>
                  </pre>
                  <p className="diagnostic-caption">
                    第 {view.range.start.line} 行，第 {view.range.start.column} 列
                    {view.range.end.line !== view.range.start.line &&
                      `，范围至第 ${view.range.end.line} 行`}
                    {view.range.byteRange.start === view.range.byteRange.end && '（插入位置）'}
                    。列从 1 开始，按 Unicode 字符计数，制表符计一列。
                  </p>
                </>
              ) : (
                <p className="diagnostic-caption">{view.unavailable}</p>
              )}
              <p data-testid="diagnostic-explanation">{view.explanation}</p>
              <p>
                <strong>可以这样检查：</strong>
                {view.action}
              </p>
              <div className="diagnostic-actions">
                {view.range && onLocateSource && (
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => onLocateSource(view.range!.byteRange)}
                  >
                    定位问题：第 {view.range.start.line} 行，第 {view.range.start.column} 列
                  </button>
                )}
                {onLocateBlock &&
                  view.blockIds.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="button button-small"
                      onClick={() => onLocateBlock(id)}
                    >
                      定位积木 {id}
                    </button>
                  ))}
              </div>
              {diagnostic.details && Object.keys(diagnostic.details).length > 0 && (
                <details className="diagnostic-details">
                  <summary>查看原始诊断依据</summary>
                  <dl>
                    {Object.entries(diagnostic.details).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{Array.isArray(value) ? value.join('、') : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
