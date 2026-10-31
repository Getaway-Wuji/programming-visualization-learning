import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { InputBinding, InputValues } from '../content/types';
import type { ExecuteResult } from '../engine/protocol';
import type { PlayerSnapshot } from '../player/model';
import { presentTrace, valueText } from '../player/presentation';
import { commitPlayerFrame } from '../player/performance';
import './array-trace.css';

function TraceDetails({
  compact,
  label,
  children,
}: {
  compact: boolean;
  label: string;
  children: ReactNode;
}) {
  return compact ? (
    <details className="trace-details">
      <summary>{label}</summary>
      {children}
    </details>
  ) : (
    children
  );
}

export function BasicTraceView({
  view,
  result,
  input,
  bindings,
  compact = false,
}: {
  view: PlayerSnapshot;
  result: ExecuteResult | undefined;
  input: InputValues;
  bindings: readonly InputBinding[];
  compact?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const presentedRun = useRef<string | null>(null);
  const presentation = useMemo(
    () => presentTrace(view, result, input, bindings),
    [view, result, input, bindings],
  );
  useLayoutEffect(() => commitPlayerFrame(view), [view]);
  useLayoutEffect(() => {
    const runId = view.identity?.runId;
    const panel = element.current?.closest(
      '[data-testid="practice-execution"], [data-testid="case-execution"]',
    );
    if (
      !runId ||
      !view.state ||
      !result?.trace ||
      presentedRun.current === runId ||
      document.visibilityState !== 'visible' ||
      ['running', 'preparing'].includes(panel?.getAttribute('data-state') ?? '')
    )
      return;
    // Present the actual accepted state when execution finishes or the same
    // retained run is opened for review. Playback ticks never move the page.
    presentedRun.current = runId;
    element.current?.closest('[data-testid="animation-panel"]')?.scrollIntoView({
      block: 'start',
      behavior: 'instant',
    });
  }, [view, result]);
  if (!presentation)
    return (
      <div className="basic-trace-view" data-testid="trace-view" data-cursor="">
        <p className="muted">
          {view.status === 'loading'
            ? '正在等待已验证的执行轨迹……'
            : '尚无当前步骤画面。运行后从初始状态开始查看。'}
        </p>
      </div>
    );
  const scalars = presentation.objects.filter((object) => object.kind === 'int');
  const arrays = presentation.objects.filter((object) => object.kind === 'int-array');
  const counters = presentation.counters;
  return (
    <div
      ref={element}
      className="basic-trace-view"
      data-testid="trace-view"
      data-cursor={view.cursor}
    >
      <p className="step-summary" data-testid="step-summary" data-step-kind={view.stepKind ?? ''}>
        {presentation.summary}
      </p>
      <div
        className="step-counters"
        data-testid="step-counters"
        data-comparisons={counters.comparisons}
        data-scalar-writes={counters.scalarWrites}
        data-array-writes={counters.arrayWrites}
        data-swaps={counters.swaps}
      >
        <span>
          比较 <strong>{counters.comparisons}</strong>
        </span>
        <span>
          变量写入 <strong>{counters.scalarWrites}</strong>
        </span>
        <span>
          数组写入 <strong>{counters.arrayWrites}</strong>
        </span>
        <span>
          交换 <strong>{counters.swaps}</strong>
        </span>
      </div>
      <TraceDetails compact={compact && arrays.length > 0} label="查看当前变量">
        <section className="step-section" aria-label="当前变量">
          <h4>变量</h4>
          {scalars.length === 0 ? (
            <p className="muted">当前没有存活变量。</p>
          ) : (
            <ul className="variable-grid">
              {scalars.map((object) => {
                const cell = object.cells[0];
                return (
                  <li
                    key={object.id}
                    className="variable-value"
                    data-testid="trace-variable"
                    data-object-id={object.id}
                    data-name={object.name}
                    data-scope-id={object.scopeId}
                    data-value={cell.value ?? 'uninitialized'}
                    data-read={cell.read}
                    data-write={cell.written}
                  >
                    <span>
                      <strong>{object.name}</strong>{' '}
                      <small>
                        {object.id} · {object.scopeId}
                      </small>
                    </span>
                    <b>{valueText(cell.value)}</b>
                    {(cell.read || cell.written) && (
                      <span className="access-label">
                        {[cell.read ? '读' : '', cell.written ? '写' : '']
                          .filter(Boolean)
                          .join(' / ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </TraceDetails>
      <section className="step-section" aria-label="当前数组">
        <h4>数组</h4>
        {arrays.length === 0 && <p className="muted">当前没有存活数组。</p>}
        {arrays.map((object) => {
          const scale = Math.max(1, ...object.cells.map((cell) => Math.abs(cell.value ?? 0)));
          const barHeight = object.cells.length > 7 ? 44 : 60;
          const labelDigits = Math.max(
            4,
            ...object.cells.map((cell) => (cell.value === null ? 0 : String(cell.value).length)),
          );
          const chartStyle = {
            '--array-cell-min': `${Math.max(52, labelDigits * 8 + 16)}px`,
            '--array-plot-height': `${barHeight * 2 + 8}px`,
          } as CSSProperties;
          return (
            <div
              key={object.id}
              className="trace-array"
              data-testid="trace-array"
              data-object-id={object.id}
              data-name={object.name}
              data-logical-length={object.length}
              data-storage-length={object.storageLength}
            >
              <p className="array-heading">
                <strong>{object.name}</strong>{' '}
                <small>
                  {object.id} · {object.scopeId}
                </small>{' '}
                · 逻辑长度 {object.length}
              </p>
              {object.length === 0 ? (
                <p className="muted">空数组：不显示存储占位项。</p>
              ) : (
                <>
                  <p className="array-chart-guide">
                    <span>按下标从左到右、逐行阅读；所有行使用同一比例。</span>
                    <span className="array-scale-label">
                      上 +{scale} · 零线 0 · 下 −{scale}
                    </span>
                  </p>
                  <div
                    className="array-chart-scroll"
                    style={chartStyle}
                    tabIndex={0}
                    aria-label={`${object.name} 数组柱状图，零线以上为非负数、以下为负数`}
                  >
                    <ol className="array-chart">
                      {object.cells.map((cell) => (
                        <li
                          key={cell.index}
                          className="array-cell"
                          data-testid="trace-array-cell"
                          data-index={cell.index}
                          data-value={cell.value ?? 'uninitialized'}
                          data-read={cell.read}
                          data-write={cell.written}
                        >
                          <span className="array-value">{valueText(cell.value)}</span>
                          <span className="bar-plot" aria-hidden="true">
                            <span
                              className={`value-bar ${cell.value === null ? 'value-unknown' : cell.value < 0 ? 'value-negative' : 'value-positive'}${cell.value === 0 ? ' value-zero' : ''}`}
                              style={{
                                height:
                                  cell.value === null
                                    ? '20px'
                                    : `${Math.max(2, (Math.abs(cell.value) / scale) * barHeight)}px`,
                              }}
                            />
                          </span>
                          <span className="array-index">[{cell.index}]</span>
                          <span className="access-label">
                            {[cell.read ? '读' : '', cell.written ? '写' : '']
                              .filter(Boolean)
                              .join(' / ') || '—'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {object.cells.some((cell) => cell.value === null) && (
                    <p className="array-uninitialized-note">斜线纹理表示未初始化，不代表数值 0。</p>
                  )}
                  {object.length > object.cells.length && (
                    <p className="muted">
                      仅展示前 {object.cells.length} / {object.length} 项；完整状态仍由轨迹保留。
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
        {presentation.objectCount > presentation.objects.length && (
          <p className="muted">
            对象较多，当前展示前 {presentation.objects.length} / {presentation.objectCount}{' '}
            个存活对象。
          </p>
        )}
      </section>
      {presentation.retired.length > 0 && (
        <p className="retired-objects">
          本步离开作用域：{presentation.retired.join('、')}；后退可恢复。
        </p>
      )}
      <TraceDetails compact={compact} label="查看本步读写与比较">
        <section
          className="step-section"
          aria-label="当前步骤的读写与比较"
          data-testid="step-events"
        >
          <h4>本步读写与比较</h4>
          {presentation.events.length === 0 ? (
            <p className="muted">本步没有读写或比较观测。</p>
          ) : (
            <ul>
              {presentation.events.map((event, i) => (
                <li key={i}>{event}</li>
              ))}
            </ul>
          )}
          {presentation.eventCount > presentation.events.length && (
            <p className="muted">
              当前展示前 {presentation.events.length} / {presentation.eventCount} 条观测。
            </p>
          )}
        </section>
      </TraceDetails>
      <section className="step-section" aria-label="当前步骤输出">
        <h4>截至当前步骤的输出</h4>
        <pre
          className="step-output"
          data-testid="step-output"
          data-output={presentation.output}
          tabIndex={0}
        >
          {presentation.output || '（无输出）'}
        </pre>
      </section>
      {view.terminal && view.terminal.status !== 'completed' && (
        <p className="trace-stop">
          轨迹在此停止：{view.terminal.diagnostics.map((d) => d.code).join('、')}
          。保留已完成步骤的状态。
        </p>
      )}
    </div>
  );
}
